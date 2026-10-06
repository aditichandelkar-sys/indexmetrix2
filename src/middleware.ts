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
      const loginUrl = new URL('/login', req.url);
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
        return NextResponse.redirect(new URL('/dashboard', req.url));
      }
    }

    return NextResponse.next();
  }

  // If already logged in and visiting login or register -> redirect to dashboard
  if (isAuthPage && sessionPayload) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
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
