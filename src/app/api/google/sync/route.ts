import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { listSearchConsoleProperties, sanitizeGoogleError } from '@/lib/google-client';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let accountId: string | undefined;
    try {
      const body = await req.json();
      accountId = body?.accountId;
    } catch {
      // Body is optional
    }

    // Ensure we only query Google accounts belonging to the current user
    const accounts = await prisma.googleAccount.findMany({
      where: accountId
        ? { id: accountId, userId: user.id }
        : { userId: user.id },
    });

    if (accounts.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No connected Google account found for this user.' },
        { status: 404 }
      );
    }

    let totalSynced = 0;
    const syncErrors: string[] = [];

    for (const account of accounts) {
      try {
        const properties = await listSearchConsoleProperties(account.id);

        for (const prop of properties) {
          await prisma.searchConsoleProperty.upsert({
            where: {
              googleAccountId_propertyUrl: {
                googleAccountId: account.id,
                propertyUrl: prop.siteUrl,
              },
            },
            update: {
              permissionLevel: prop.permissionLevel,
              isVerified: true,
            },
            create: {
              googleAccountId: account.id,
              propertyUrl: prop.siteUrl,
              permissionLevel: prop.permissionLevel,
              isVerified: true,
            },
          });
        }

        totalSynced += properties.length;
      } catch (err: any) {
        const rawMsg = err?.cause?.message ? `${err.message} (${err.cause.message})` : (err?.message || 'Failed to sync Search Console properties');
        const sanitized = sanitizeGoogleError(rawMsg);
        console.error(`Error syncing properties for Google account ${account.email}:`, sanitized);

        syncErrors.push(`${account.email}: ${sanitized}`);
      }
    }

    if (syncErrors.length > 0 && totalSynced === 0) {
      return NextResponse.json(
        {
          success: false,
          error: syncErrors.join('; '),
        },
        { status: 502 }
      );
    }

    // Return the updated accounts and properties without exposing tokens
    const updatedAccounts = await prisma.googleAccount.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        userId: true,
        email: true,
        status: true,
        scopes: true,
        tokenExpiresAt: true,
        createdAt: true,
        updatedAt: true,
        properties: {
          select: {
            id: true,
            googleAccountId: true,
            projectId: true,
            propertyUrl: true,
            permissionLevel: true,
            isVerified: true,
            createdAt: true,
            updatedAt: true,
            project: { select: { id: true, name: true, domain: true } },
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      syncedCount: totalSynced,
      accounts: updatedAccounts,
      warning: syncErrors.length > 0 ? syncErrors.join('; ') : undefined,
    });
  } catch (err: any) {
    console.error('Unexpected error in /api/google/sync:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error while syncing properties' },
      { status: 500 }
    );
  }
}
