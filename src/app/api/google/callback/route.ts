import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt } from 'jose';
import { prisma } from '@/lib/db';
import { exchangeCodeForTokens, listSearchConsoleProperties, GOOGLE_OAUTH_SCOPES } from '@/lib/google-client';
import { encryptText } from '@/lib/crypto';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(new URL(`/google?error=${encodeURIComponent(error)}`, req.url));
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL('/google?error=missing_code_or_state', req.url));
    }

    const userId = state.split(':')[0];
    if (!userId) {
      return NextResponse.redirect(new URL('/google?error=invalid_state', req.url));
    }

    // Verify user exists in database
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      return NextResponse.redirect(new URL('/google?error=user_not_found', req.url));
    }

    const tokens = await exchangeCodeForTokens(code);

    // Extract real email from idToken or Google userinfo
    let email = '';
    if (tokens.idToken) {
      try {
        const claims = decodeJwt(tokens.idToken);
        if (claims.email && typeof claims.email === 'string') {
          email = claims.email;
        }
      } catch (e) {
        console.warn('Could not decode idToken claims:', e);
      }
    }

    if (!email && tokens.accessToken) {
      try {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        if (userInfoRes.ok) {
          const userInfo = await userInfoRes.json();
          if (userInfo.email) {
            email = userInfo.email;
          }
        }
      } catch (e) {
        console.warn('Could not fetch userinfo from Google:', e);
      }
    }

    if (!email) {
      email = user.email;
    }

    const expiresAt = new Date(Date.now() + (tokens.expiresIn || 3600) * 1000);

    // Upsert or update existing connected account for this user and email
    let googleAccount = await prisma.googleAccount.findFirst({
      where: {
        userId,
        email,
      },
    });

    if (googleAccount) {
      googleAccount = await prisma.googleAccount.update({
        where: { id: googleAccount.id },
        data: {
          encryptedAccessToken: encryptText(tokens.accessToken),
          ...(tokens.refreshToken ? { encryptedRefreshToken: encryptText(tokens.refreshToken) } : {}),
          tokenExpiresAt: expiresAt,
          scopes: tokens.scope || GOOGLE_OAUTH_SCOPES.join(' '),
          status: 'ACTIVE',
        },
      });
    } else {
      googleAccount = await prisma.googleAccount.create({
        data: {
          userId,
          email,
          encryptedAccessToken: encryptText(tokens.accessToken),
          encryptedRefreshToken: tokens.refreshToken ? encryptText(tokens.refreshToken) : null,
          tokenExpiresAt: expiresAt,
          scopes: tokens.scope || GOOGLE_OAUTH_SCOPES.join(' '),
          status: 'ACTIVE',
        },
      });
    }

    // Automatically fetch verified Search Console properties
    try {
      const properties = await listSearchConsoleProperties(googleAccount.id);
      for (const prop of properties) {
        await prisma.searchConsoleProperty.upsert({
          where: {
            googleAccountId_propertyUrl: {
              googleAccountId: googleAccount.id,
              propertyUrl: prop.siteUrl,
            },
          },
          update: {
            permissionLevel: prop.permissionLevel,
          },
          create: {
            googleAccountId: googleAccount.id,
            propertyUrl: prop.siteUrl,
            permissionLevel: prop.permissionLevel,
            isVerified: true,
          },
        });
      }
    } catch (e: any) {
      console.warn('Could not auto-fetch properties immediately:', e?.message || e);
    }

    // Establish/refresh session cookie so browser is authenticated on /google
    const sessionToken = await createSessionToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as any,
      creditMode: user.creditMode as any,
      status: user.status as any,
    });

    const response = NextResponse.redirect(new URL('/google?success=connected', req.url));
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (err: any) {
    const rawMessage = err?.message || 'unknown';
    // Sanitize any secrets/tokens from the message
    const sanitized = rawMessage
      .replace(/GOCSPX-[A-Za-z0-9_-]+/g, '[REDACTED_CLIENT_SECRET]')
      .replace(/ya29\.[A-Za-z0-9_-]+/g, '[REDACTED_ACCESS_TOKEN]')
      .replace(/1\/\/[A-Za-z0-9_-]+/g, '[REDACTED_REFRESH_TOKEN]');
    console.error('Google OAuth callback error:', sanitized);

    return NextResponse.redirect(
      new URL(`/google?error=${encodeURIComponent(sanitized)}`, req.url)
    );
  }
}
