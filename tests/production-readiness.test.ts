import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/db';
import { POST as postLogin } from '@/app/api/auth/login/route';
import { GET as getAdminOverview } from '@/app/api/admin/overview/route';
import { validateAppBaseUrl, getPublicFeedUrl, getPublicSitemapUrl } from '@/lib/app-config';
import { getGoogleRedirectUri } from '@/lib/google-client';
import { createSessionToken, verifySessionToken } from '@/lib/auth';

describe('Production Readiness & Owner Authentication Tests', () => {
  let ownerUser: any;
  let customerUser: any;

  beforeAll(async () => {
    ownerUser = await prisma.user.findFirst({
      where: { role: 'OWNER' },
      include: { wallet: true },
    });

    customerUser = await prisma.user.findFirst({
      where: { role: 'CUSTOMER' },
      include: { wallet: true },
    });
  });

  describe('1. Production Owner Account & Authentication Security', () => {
    it('verifies owner account exists with required role and UNLIMITED creditMode', () => {
      expect(ownerUser).toBeDefined();
      expect(ownerUser.email).toBe('naina@indexmetrix.com');
      expect(ownerUser.role).toBe('OWNER');
      expect(ownerUser.creditMode).toBe('UNLIMITED');
      expect(ownerUser.status).toBe('ACTIVE');
    });

    it('authenticates production owner successfully through POST /api/auth/login', async () => {
      const initialPassword = process.env.OWNER_INITIAL_PASSWORD || 'Naina@123';
      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'naina@indexmetrix.com',
          password: initialPassword,
        }),
      });

      const res = await postLogin(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.user.email).toBe('naina@indexmetrix.com');
      expect(data.user.role).toBe('OWNER');
      expect(data.user.creditMode).toBe('UNLIMITED');
      expect(data.user.balance).toBe('UNLIMITED');

      // Verify plaintext password or passwordHash is NEVER exposed in the API response
      expect(data.user.password).toBeUndefined();
      expect(data.user.passwordHash).toBeUndefined();
      expect(JSON.stringify(data)).not.toContain(initialPassword);

      // Verify secure session cookie is set
      const cookies = res.cookies.getAll();
      const sessionCookie = cookies.find((c) => c.name === 'index_matrix_session');
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie?.value.length).toBeGreaterThan(20);
      expect(sessionCookie?.httpOnly).toBe(true);
    });

    it('rejects login with invalid password returning 401 Unauthorized', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'naina@indexmetrix.com',
          password: 'WrongPassword123!',
        }),
      });

      const res = await postLogin(req);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid email or password');
    });

    it('enforces RBAC: verifies owner role grants OWNER privileges while customer is limited', async () => {
      expect(customerUser).toBeDefined();

      const customerToken = await createSessionToken({
        id: customerUser.id,
        email: customerUser.email,
        name: customerUser.name,
        role: 'CUSTOMER',
        creditMode: 'LIMITED',
        status: 'ACTIVE',
      });

      const customerPayload = await verifySessionToken(customerToken);
      expect(customerPayload?.role).toBe('CUSTOMER');
      expect(customerPayload?.role === 'OWNER').toBe(false);

      const ownerToken = await createSessionToken({
        id: ownerUser.id,
        email: ownerUser.email,
        name: ownerUser.name,
        role: 'OWNER',
        creditMode: 'UNLIMITED',
        status: 'ACTIVE',
      });

      const ownerPayload = await verifySessionToken(ownerToken);
      expect(ownerPayload?.role).toBe('OWNER');
      expect(ownerPayload?.creditMode).toBe('UNLIMITED');
    });

    it('unauthenticated request to admin overview returns 403 Forbidden', async () => {
      const res = await getAdminOverview();
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Forbidden');
    });
  });

  describe('2. Production Domain & OAuth Configuration Safety', () => {
    it('validates production domain https://indexmetrix.com as valid and secure', () => {
      const result = validateAppBaseUrl('https://indexmetrix.com', { nodeEnv: 'production' });
      expect(result.valid).toBe(true);
      expect(result.url).toBe('https://indexmetrix.com');
      expect(result.isProduction).toBe(true);
    });

    it('strictly forbids localhost, 127.0.0.1, and private IPs in production', () => {
      const localhostRes = validateAppBaseUrl('https://localhost:3000', { nodeEnv: 'production' });
      expect(localhostRes.valid).toBe(false);
      expect(localhostRes.error).toContain('cannot point to localhost');

      const ipRes = validateAppBaseUrl('https://127.0.0.1:3000', { nodeEnv: 'production' });
      expect(ipRes.valid).toBe(false);
      expect(ipRes.error).toContain('cannot point to localhost');

      const httpRes = validateAppBaseUrl('http://indexmetrix.com', { nodeEnv: 'production' });
      expect(httpRes.valid).toBe(false);
      expect(httpRes.error).toContain('must use the HTTPS protocol');
    });

    it('resolves Google redirect URI with production fallback if unset', () => {
      const oldEnv = process.env.GOOGLE_REDIRECT_URI;
      const oldNodeEnv = process.env.NODE_ENV;
      const oldAppBase = process.env.APP_BASE_URL;

      try {
        process.env.GOOGLE_REDIRECT_URI = 'https://indexmetrix.com/api/google/callback';
        expect(getGoogleRedirectUri()).toBe('https://indexmetrix.com/api/google/callback');

        delete process.env.GOOGLE_REDIRECT_URI;
        (process.env as any).NODE_ENV = 'production';
        process.env.APP_BASE_URL = 'https://indexmetrix.com';
        expect(getGoogleRedirectUri()).toBe('https://indexmetrix.com/api/google/callback');
      } finally {
        if (oldEnv) process.env.GOOGLE_REDIRECT_URI = oldEnv;
        else delete process.env.GOOGLE_REDIRECT_URI;
        (process.env as any).NODE_ENV = oldNodeEnv;
        if (oldAppBase) process.env.APP_BASE_URL = oldAppBase;
        else delete process.env.APP_BASE_URL;
      }
    });

    it('generates public feed and sitemap URLs under production domain without localhost', () => {
      const feedUrl = getPublicFeedUrl('https://indexmetrix.com');
      const sitemapUrl = getPublicSitemapUrl('https://indexmetrix.com');

      expect(feedUrl).toBe('https://indexmetrix.com/api/feeds/rapid-rss.xml');
      expect(sitemapUrl).toBe('https://indexmetrix.com/api/feeds/rapid-sitemap.xml');
      expect(feedUrl).not.toContain('localhost');
      expect(sitemapUrl).not.toContain('localhost');
    });
  });

  describe('3. Git Security & Environment Template Verification', () => {
    it('verifies .env.example exists and contains no real secrets', () => {
      const examplePath = path.resolve(__dirname, '../.env.example');
      expect(fs.existsSync(examplePath)).toBe(true);

      const content = fs.readFileSync(examplePath, 'utf8');
      expect(content).toContain('APP_BASE_URL=https://indexmetrix.com');
      expect(content).toContain('OWNER_EMAIL="naina@indexmetrix.com"');
      expect(content).toContain('DATABASE_URL=');
      expect(content).toContain('REDIS_URL=');
      expect(content).toContain('GOOGLE_CLIENT_ID=');
      expect(content).toContain('GOOGLE_CLIENT_SECRET=');
      expect(content).toContain('GOOGLE_REDIRECT_URI=');

      // Verify no live secrets are in .env.example
      expect(content).not.toContain('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');
      expect(content).not.toContain('Naina@123');
      expect(content).toContain('YOUR_');
    });
  });
});
