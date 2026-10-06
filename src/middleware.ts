import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.APP_SECRET || 'index-matrix-super-secret-key-min-32-chars-long-1234567890'
);

const SESSION_COOKIE_NAME = 'index_matrix_session';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/projects',
  '/urls',
  '/import',
  '/google',
  '/properties',
  '/quick-index',
  '/sitemaps',
  '/jobs',
  '/monitoring',
  '/credits',
  '/payments',
  '/transactions',
  '/api-keys',
  '/settings',
  '/admin',
];

function getMiddlewareRedirectUrl(targetPath: string, req: NextRequest): URL {
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    const configured = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
    let base = 'https://indexmetrix.com';
    if (configured) {
      try {
        const parsed = new URL(configured);
        const host = parsed.hostname.toLowerCase();
        if (host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.local') && parsed.protocol === 'https:') {
          base = `${parsed.protocol}//${parsed.host}`;
        }
      } catch {
        base = 'https://indexmetrix.com';
      }
    } else {
      const forwardedHost = req.headers.get('x-forwarded-host');
      const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
      if (forwardedHost && !forwardedHost.includes('localhost') && !forwardedHost.includes('127.0.0.1')) {
        base = `${forwardedProto}://${forwardedHost}`;
      }
    }
    return new URL(targetPath, base);
  }

  const nextUrl = req.nextUrl.clone();
  nextUrl.pathname = targetPath;
  return nextUrl;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isAuthPage = pathname === '/login' || pathname === '/register';

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  let sessionPayload: any = null;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      if (payload?.sub && payload?.email && payload?.status !== 'SUSPENDED') {
        sessionPayload = payload;
      }
    } catch {
      sessionPayload = null;
    }
  }

  // If trying to access protected route without valid session -> redirect to login
  if (isProtected) {
    if (!sessionPayload) {
      const loginUrl = getMiddlewareRedirectUrl('/login', req);
      loginUrl.searchParams.set('from', pathname);
      const res = NextResponse.redirect(loginUrl);
      if (token) {
        res.cookies.delete(SESSION_COOKIE_NAME);
      }
      return res;
    }

    // If trying to access admin routes without OWNER role -> redirect to dashboard
    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      if (sessionPayload.role !== 'OWNER') {
        return NextResponse.redirect(getMiddlewareRedirectUrl('/dashboard', req));
      }
    }

    return NextResponse.next();
  }

  // If already logged in and visiting login or register -> redirect to dashboard
  if (isAuthPage && sessionPayload) {
    return NextResponse.redirect(getMiddlewareRedirectUrl('/dashboard', req));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes handle their own JSON authentication)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
