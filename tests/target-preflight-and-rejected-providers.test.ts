import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/db';
import { validateTargetPreflight, checkPdfMagicBytes } from '../src/lib/target-preflight';
import { dispatchFastIndexing } from '../src/lib/fast-indexer';
import { POST as postFastIndex } from '../src/app/api/urls/fast-index/route';
import * as auth from '../src/lib/auth';

describe('Target Pre-Flight Validation & Rejected Provider Telemetry', () => {
  let customerUser: any;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;

    customerUser = await prisma.user.findFirst({
      where: { email: 'customer@indexmatrix.io' },
      include: { wallet: true },
    });

    if (!customerUser) {
      customerUser = await prisma.user.create({
        data: {
          email: 'customer@indexmatrix.io',
          passwordHash: 'dummy',
          name: 'Acme Digital Media',
          role: 'CUSTOMER',
          wallet: { create: { balance: 100 } },
        },
        include: { wallet: true },
      });
    }

    vi.spyOn(auth, 'getSessionUser').mockResolvedValue({
      id: customerUser.id,
      email: customerUser.email,
      name: customerUser.name,
      role: customerUser.role,
      creditMode: 'LIMITED',
    } as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. Confirmed Dead Targets (404 and 410)', () => {
    it('identifies confirmed 404 Not Found target as dead and blocks dispatch', async () => {
      global.fetch = vi.fn().mockImplementation((url, init) => {
        return Promise.resolve(
          new Response('<html><body>404 Not Found</body></html>', {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'text/html' },
          })
        );
      });

      const res = await validateTargetPreflight('https://example.com/missing-doc.pdf');

      expect(res.canDispatch).toBe(false);
      expect(res.isDead).toBe(true);
      expect(res.status).toBe('CONFIRMED_DEAD');
      expect(res.httpStatus).toBe(404);
      expect(res.errorMessage).toContain('404');
    });

    it('identifies confirmed 410 Gone target as dead and blocks dispatch', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(
          new Response('Gone', {
            status: 410,
            statusText: 'Gone',
            headers: { 'Content-Type': 'text/plain' },
          })
        );
      });

      const res = await validateTargetPreflight('https://example.com/expired-report.pdf');

      expect(res.canDispatch).toBe(false);
      expect(res.isDead).toBe(true);
      expect(res.status).toBe('CONFIRMED_DEAD');
      expect(res.httpStatus).toBe(410);
    });
  });

  describe('2. Valid PDF Verification & Magic Bytes', () => {
    it('verifies %PDF- magic bytes correctly', () => {
      const validPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
      const htmlBytes = new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50]); // <!DOCTYP

      expect(checkPdfMagicBytes(validPdfBytes)).toBe(true);
      expect(checkPdfMagicBytes(htmlBytes)).toBe(false);
    });

    it('validates a reachable PDF and marks it active and dispatchable', async () => {
      const samplePdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

      global.fetch = vi.fn().mockImplementation((url, init) => {
        if (init?.method === 'HEAD') {
          return Promise.resolve(
            new Response(null, {
              status: 200,
              headers: { 'Content-Type': 'application/pdf' },
            })
          );
        }
        return Promise.resolve(
          new Response(samplePdf, {
            status: 200,
            headers: { 'Content-Type': 'application/pdf' },
          })
        );
      });

      const res = await validateTargetPreflight('https://example.com/document.pdf');

      expect(res.canDispatch).toBe(true);
      expect(res.isDead).toBe(false);
      expect(res.status).toBe('ACTIVE');
      expect(res.httpStatus).toBe(200);
      expect(res.isPdf).toBe(true);
      expect(res.isPdfSignatureValid).toBe(true);
    });
  });

  describe('3. Unsupported HEAD Handling (Safe GET Fallback)', () => {
    it('does NOT classify URL as dead when HEAD returns 405 Method Not Allowed, but GET returns 200', async () => {
      global.fetch = vi.fn().mockImplementation((url, init) => {
        if (init?.method === 'HEAD') {
          return Promise.resolve(
            new Response(null, {
              status: 405,
              statusText: 'Method Not Allowed',
            })
          );
        }
        // Fallback GET
        return Promise.resolve(
          new Response('<html><body>Live Landing Page</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        );
      });

      const res = await validateTargetPreflight('https://example.com/legacy-endpoint');

      expect(res.canDispatch).toBe(true);
      expect(res.isDead).toBe(false);
      expect(res.status).toBe('ACTIVE');
      expect(res.httpStatus).toBe(200);
    });

    it('does NOT classify URL as dead when HEAD fails with network error, but GET returns 200', async () => {
      global.fetch = vi.fn().mockImplementation((url, init) => {
        if (init?.method === 'HEAD') {
          return Promise.reject(new Error('Connection reset by peer during HEAD'));
        }
        return Promise.resolve(
          new Response('OK', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          })
        );
      });

      const res = await validateTargetPreflight('https://example.com/resilient-server');

      expect(res.canDispatch).toBe(true);
      expect(res.isDead).toBe(false);
      expect(res.status).toBe('ACTIVE');
      expect(res.httpStatus).toBe(200);
    });
  });

  describe('4. Timeouts, Rate Limits, and Access Restrictions are Distinct', () => {
    it('classifies 403 Forbidden as ACCESS_RESTRICTED rather than confirmed dead', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(
          new Response('Forbidden', {
            status: 403,
            statusText: 'Forbidden',
            headers: { 'Content-Type': 'text/html' },
          })
        );
      });

      const res = await validateTargetPreflight('https://example.com/admin/private.pdf');

      expect(res.canDispatch).toBe(false);
      expect(res.isDead).toBe(false);
      expect(res.status).toBe('ACCESS_RESTRICTED');
      expect(res.httpStatus).toBe(403);
    });

    it('classifies 429 Too Many Requests as RATE_LIMITED rather than confirmed dead', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(
          new Response('Rate Limited', {
            status: 429,
            statusText: 'Too Many Requests',
          })
        );
      });

      const res = await validateTargetPreflight('https://example.com/rate-limited-api');

      expect(res.canDispatch).toBe(false);
      expect(res.isDead).toBe(false);
      expect(res.status).toBe('RATE_LIMITED');
      expect(res.httpStatus).toBe(429);
    });

    it('classifies request timeout as TIMEOUT rather than confirmed dead', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      global.fetch = vi.fn().mockRejectedValue(abortError);

      const res = await validateTargetPreflight('https://example.com/slow-endpoint');

      expect(res.canDispatch).toBe(false);
      expect(res.isDead).toBe(false);
      expect(res.status).toBe('TIMEOUT');
    });
  });

  describe('5. SSRF and Private IP Protection', () => {
    it('blocks loopback IP addresses (127.0.0.1) before any outbound request', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const res = await validateTargetPreflight('http://127.0.0.1:8080/internal.pdf');

      expect(res.canDispatch).toBe(false);
      expect(res.isDead).toBe(false);
      expect(res.status).toBe('BLOCKED_SSRF');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('blocks cloud metadata IP (169.254.169.254) before any outbound request', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const res = await validateTargetPreflight('http://169.254.169.254/latest/meta-data');

      expect(res.canDispatch).toBe(false);
      expect(res.isDead).toBe(false);
      expect(res.status).toBe('BLOCKED_SSRF');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('blocks private 10.x.x.x networks', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const res = await validateTargetPreflight('http://10.0.0.1/report.pdf');

      expect(res.canDispatch).toBe(false);
      expect(res.status).toBe('BLOCKED_SSRF');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('6. Rejected Provider Response Handling', () => {
    it('records IndexNow HTTP 422 as REJECTED and never reports it as SUCCESS', async () => {
      global.fetch = vi.fn().mockImplementation((url) => {
        const u = String(url);
        if (u.includes('api.indexnow.org')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                message: 'Invalid key location for host',
              }),
              {
                status: 422,
                statusText: 'Unprocessable Entity',
                headers: { 'Content-Type': 'application/json' },
              }
            )
          );
        }
        if (u.includes('translate.google.com')) {
          return Promise.resolve(new Response('OK', { status: 200 }));
        }
        if (u.includes('pubsubhubbub')) {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (u.includes('bing.com/ping')) {
          return Promise.resolve(new Response('OK', { status: 200 }));
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      const summary = await dispatchFastIndexing('https://thirdparty.org/document.pdf', {
        simulated: false,
        appBaseUrl: 'https://indexmetrix.com',
      });

      const indexNowVector = summary.vectors.find((v) => v.vector === 'INDEXNOW_API');
      expect(indexNowVector).toBeDefined();
      expect(indexNowVector?.status).toBe('REJECTED');
      expect(indexNowVector?.statusCode).toBe(422);
      expect(indexNowVector?.status).not.toBe('SUCCESS');
      expect(summary.rejectedVectors).toBe(1);
      // Confirms rejected vector is NOT counted as successful
      expect(summary.successfulVectors).toBeLessThan(summary.totalVectors);
      expect(summary.overallStatus).toBe('PARTIAL');
    });
  });

  describe('7. End-to-End Route Credit Protection for Dead URLs', () => {
    it('rejects confirmed 404 URL in POST /api/urls/fast-index and DOES NOT deduct credits', async () => {
      // Mock fetch to simulate target server returning 404
      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(
          new Response('<html><body>Not Found</body></html>', {
            status: 404,
            headers: { 'Content-Type': 'text/html' },
          })
        );
      });

      const initialWallet = await prisma.creditWallet.findUnique({
        where: { userId: customerUser.id },
      });
      const initialBalance = initialWallet?.balance ?? 100;

      const req = new NextRequest('http://localhost:3000/api/urls/fast-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: ['https://actv.avmspa.it/sites/default/files/webform/missing-404.pdf'],
        }),
      });

      const res = await postFastIndex(req);
      const data = await res.json();

      expect(res.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.dispatchedCount).toBe(0);
      expect(data.error).toContain('404');

      // Verify wallet balance is completely untouched
      const finalWallet = await prisma.creditWallet.findUnique({
        where: { userId: customerUser.id },
      });
      expect(finalWallet?.balance).toBe(initialBalance);
    });

    it('rejects SSRF attempt in POST /api/urls/fast-index and DOES NOT deduct credits', async () => {
      const initialWallet = await prisma.creditWallet.findUnique({
        where: { userId: customerUser.id },
      });
      const initialBalance = initialWallet?.balance ?? 100;

      const req = new NextRequest('http://localhost:3000/api/urls/fast-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: ['http://127.0.0.1:9000/secret.pdf'],
        }),
      });

      const res = await postFastIndex(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.dispatchedCount).toBe(0);
      expect(data.error).toContain('SSRF');

      // Verify wallet balance is completely untouched
      const finalWallet = await prisma.creditWallet.findUnique({
        where: { userId: customerUser.id },
      });
      expect(finalWallet?.balance).toBe(initialBalance);
    });
  });
});
