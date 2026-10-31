import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/db';
import { validateTargetPreflight, checkPdfMagicBytes, inspectRobotsTxtForUrl } from '../src/lib/target-preflight';
import { dispatchFastIndexing } from '../src/lib/fast-indexer';
import { IndexNowProvider } from '../src/lib/discovery/providers/IndexNowProvider';
import { POST as postFastIndex } from '../src/app/api/urls/fast-index/route';
import { POST as postSubmit } from '../src/app/api/urls/submit/route';
import { deductCredits } from '../src/lib/credit-ledger';
import * as auth from '../src/lib/auth';

describe('Third-Party PDF Indexing Audit & Fix Test Suite', () => {
  let customerUser: any;
  let thirdPartyProject: any;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;

    customerUser = await prisma.user.findFirst({
      where: { email: 'customer-pdf-audit@indexmatrix.io' },
      include: { wallet: true },
    });

    if (!customerUser) {
      customerUser = await prisma.user.create({
        data: {
          email: 'customer-pdf-audit@indexmatrix.io',
          passwordHash: 'dummy-hash',
          name: 'PDF Audit Customer',
          role: 'CUSTOMER',
          wallet: { create: { balance: 100 } },
        },
        include: { wallet: true },
      });
    }

    thirdPartyProject = await prisma.project.findFirst({
      where: { userId: customerUser.id, name: 'PDF Audit Project' },
    });

    if (!thirdPartyProject) {
      thirdPartyProject = await prisma.project.create({
        data: {
          userId: customerUser.id,
          name: 'PDF Audit Project',
          domain: 'third-party-links.io',
          description: 'Project for testing 3rd-party forum and PDF indexing.',
        },
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

  // =========================================================================
  // Requirement F.1: Public PDF URL returning HTTP 200
  // =========================================================================
  describe('1. Public PDF URL returning HTTP 200', () => {
    it('safely verifies HTTP status 200, Content-Type, Content-Length, and %PDF- signature', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 0x0a]); // %PDF-1.5

      global.fetch = vi.fn().mockImplementation((url, init) => {
        if (init?.method === 'HEAD') {
          return Promise.resolve(
            new Response(null, {
              status: 200,
              headers: {
                'Content-Type': 'application/pdf',
                'Content-Length': '8192',
                'Link': '<https://example.com/canonical.pdf>; rel="canonical"',
              },
            })
          );
        }
        return Promise.resolve(
          new Response(pdfBytes, {
            status: 200,
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Length': '8192',
              'Link': '<https://example.com/canonical.pdf>; rel="canonical"',
            },
          })
        );
      });

      const res = await validateTargetPreflight('https://example.com/public-doc.pdf');

      expect(res.canDispatch).toBe(true);
      expect(res.isDead).toBe(false);
      expect(res.status).toBe('ACTIVE');
      expect(res.httpStatus).toBe(200);
      expect(res.contentType).toContain('application/pdf');
      expect(res.contentLength).toBe(8192);
      expect(res.isPdf).toBe(true);
      expect(res.isPdfSignatureValid).toBe(true);
      expect(res.canonicalUrl).toBe('https://example.com/canonical.pdf');
      expect(res.checkedAt).toBeDefined();
      expect(new Date(res.checkedAt!).getTime()).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Requirement F.2: PDF returning HTTP 403 Forbidden
  // =========================================================================
  describe('2. PDF returning HTTP 403 Forbidden', () => {
    it('identifies HTTP 403 as ACCESS_RESTRICTED, flags authRequired, and blocks dispatch', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(
          new Response('<html><body>403 Forbidden - Access Denied</body></html>', {
            status: 403,
            statusText: 'Forbidden',
            headers: { 'Content-Type': 'text/html' },
          })
        );
      });

      const res = await validateTargetPreflight('https://proboards.com/attachments/private.pdf');

      expect(res.canDispatch).toBe(false);
      expect(res.isDead).toBe(false);
      expect(res.status).toBe('ACCESS_RESTRICTED');
      expect(res.httpStatus).toBe(403);
      expect(res.authRequired).toBe(true);
      expect(res.errorMessage).toContain('Access Restricted');
      expect(res.checkedAt).toBeDefined();
    });
  });

  // =========================================================================
  // Requirement F.3: Missing PDF returning HTTP 404
  // =========================================================================
  describe('3. Missing PDF returning HTTP 404', () => {
    it('identifies HTTP 404 as CONFIRMED_DEAD, marks isDead, and blocks dispatch', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(
          new Response('<html><body>404 Attachment Not Found</body></html>', {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'text/html' },
          })
        );
      });

      const res = await validateTargetPreflight('https://example.org/files/deleted.pdf');

      expect(res.canDispatch).toBe(false);
      expect(res.isDead).toBe(true);
      expect(res.status).toBe('CONFIRMED_DEAD');
      expect(res.httpStatus).toBe(404);
      expect(res.errorMessage).toContain('404');
      expect(res.checkedAt).toBeDefined();
    });
  });

  // =========================================================================
  // Requirement F.4: PDF with X-Robots-Tag noindex
  // =========================================================================
  describe('4. PDF with X-Robots-Tag noindex', () => {
    it('inspects and flags X-Robots-Tag: noindex, none header', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

      global.fetch = vi.fn().mockImplementation((url, init) => {
        if (init?.method === 'HEAD') {
          return Promise.resolve(
            new Response(null, {
              status: 200,
              headers: {
                'Content-Type': 'application/pdf',
                'X-Robots-Tag': 'noindex, noarchive',
              },
            })
          );
        }
        return Promise.resolve(
          new Response(pdfBytes, {
            status: 200,
            headers: {
              'Content-Type': 'application/pdf',
              'X-Robots-Tag': 'noindex, noarchive',
            },
          })
        );
      });

      const res = await validateTargetPreflight('https://example.com/restricted.pdf');

      expect(res.xRobotsTag).toContain('noindex');
      expect(res.warningMessage).toContain('X-Robots-Tag: noindex header');
    });

    it('inspects robots.txt disallow rules for crawlers', async () => {
      const mockRobots = `
User-agent: *
Disallow: /forum/attachments/
`;
      global.fetch = vi.fn().mockImplementation((url) => {
        if (String(url).endsWith('/robots.txt')) {
          return Promise.resolve(new Response(mockRobots, { status: 200 }));
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      const rCheck = await inspectRobotsTxtForUrl('https://example.com/forum/attachments/doc.pdf');
      expect(rCheck.status).toBe('DISALLOWED');
      expect(rCheck.warning).toContain('disallows search engine crawlers');
    });
  });

  // =========================================================================
  // Requirement F.5: External forum thread URL (ProBoards)
  // =========================================================================
  describe('5. External forum thread URL handling', () => {
    it('handles standard public forum HTML page safely without treating it as PDF error', async () => {
      const forumHtml = `<!DOCTYPE html><html><head><title>ProBoards Community Discussion</title></head><body><h1>Welcome</h1></body></html>`;

      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(
          new Response(forumHtml, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Content-Length': String(forumHtml.length),
            },
          })
        );
      });

      const res = await validateTargetPreflight('https://happyalone.proboards.com/thread/123/discussion');

      expect(res.canDispatch).toBe(true);
      expect(res.status).toBe('ACTIVE');
      expect(res.httpStatus).toBe(200);
      expect(res.isPdf).toBe(false);
      expect(res.isDisguisedHtml).toBe(false);
    });

    it('detects HTML login gate disguised as a PDF attachment URL', async () => {
      const loginHtml = `<html><body><h2>Please Log In to View This Attachment</h2><form method="post"><input type="password" /></form></body></html>`;

      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(
          new Response(loginHtml, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          })
        );
      });

      const res = await validateTargetPreflight('https://forum.proboards.com/attachment/download/file.pdf');

      expect(res.canDispatch).toBe(false);
      expect(res.status).toBe('ACCESS_RESTRICTED');
      expect(res.authRequired).toBe(true);
      expect(res.isDisguisedHtml).toBe(true);
      expect(res.errorMessage).toContain('authentication gate or login barrier');
    });

    it('detects soft 404 HTML error page disguised as a PDF attachment', async () => {
      const soft404Html = `<html><body><h1>404 Not Found</h1><p>Attachment not found or deleted by admin.</p></body></html>`;

      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(
          new Response(soft404Html, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          })
        );
      });

      const res = await validateTargetPreflight('https://forum.proboards.com/attachment/download/missing.pdf');

      expect(res.canDispatch).toBe(false);
      expect(res.isDead).toBe(true);
      expect(res.status).toBe('CONFIRMED_DEAD');
      expect(res.isDisguisedHtml).toBe(true);
      expect(res.errorMessage).toContain('HTML error page disguised as a PDF');
    });
  });

  // =========================================================================
  // Requirement F.6: IndexNow HTTP 422 Diagnosis and Protection
  // =========================================================================
  describe('6. IndexNow HTTP 422 Diagnosis and Protection', () => {
    it('IndexNowProvider refuses to submit unowned third-party domain without verified key', async () => {
      const provider = new IndexNowProvider();
      const exec = await provider.submit('https://forums.proboards.com/thread/100', {
        urlId: 'test-url-id',
        userProperties: [],
      } as any);

      expect(exec.accepted).toBe(false);
      expect(exec.requestStatus).toBe('NOT_AUTHORIZED');
      expect(exec.errorCode).toBe('NOT_AUTHORIZED_FOR_INDEXNOW');
      expect(exec.errorMessage).toContain('cannot be legitimately verified on unowned third-party domain');
    });

    it('diagnoses and records HTTP 422 Unprocessable Entity as REJECTED', async () => {
      global.fetch = vi.fn().mockImplementation((url) => {
        if (String(url).includes('api.indexnow.org')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                message: 'Invalid key location for host: Key not found on host root',
              }),
              {
                status: 422,
                statusText: 'Unprocessable Entity',
                headers: { 'Content-Type': 'application/json' },
              }
            )
          );
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      });

      const summary = await dispatchFastIndexing('https://external-unowned.org/file.pdf', {
        simulated: false,
        appBaseUrl: 'https://indexmetrix.com',
      });

      const indexNowVector = summary.vectors.find((v) => v.vector === 'INDEXNOW_API');
      expect(indexNowVector?.status).toBe('REJECTED');
      expect(indexNowVector?.statusCode).toBe(422);
      expect(indexNowVector?.message).toContain('HTTP 422 Unprocessable Entity');
      expect(summary.rejectedVectors).toBe(1);
    });
  });

  // =========================================================================
  // Requirement F.7: Queue/Database Persistence and Idempotency
  // =========================================================================
  describe('7. Queue & Database Persistence and Idempotency', () => {
    it('creates IndexingJob and IndexingJobItem records so fast-indexed URLs appear in Indexing Jobs', async () => {
      const targetUrl = `https://example.com/persisted-job-${Date.now()}.pdf`;
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

      global.fetch = vi.fn().mockImplementation((url, init) => {
        if (init?.method === 'HEAD') {
          return Promise.resolve(
            new Response(null, {
              status: 200,
              headers: { 'Content-Type': 'application/pdf', 'Content-Length': '1024' },
            })
          );
        }
        return Promise.resolve(
          new Response(pdfBytes, {
            status: 200,
            headers: { 'Content-Type': 'application/pdf', 'Content-Length': '1024' },
          })
        );
      });

      const batchKey = `test_batch_key_${Date.now()}`;
      const req = new NextRequest('http://localhost:3000/api/urls/fast-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [targetUrl],
          projectId: thirdPartyProject.id,
          idempotencyKey: batchKey,
        }),
      });

      const res = await postFastIndex(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.job).toBeDefined();
      expect(data.job.id).toBeDefined();

      // Verify record exists in prisma.indexingJob
      const jobInDb = await prisma.indexingJob.findUnique({
        where: { id: data.job.id },
        include: { items: { include: { url: true } } },
      });

      expect(jobInDb).toBeDefined();
      expect(jobInDb?.totalUrls).toBe(1);
      expect(jobInDb?.items.length).toBe(1);
      expect(jobInDb?.items[0].url.normalizedUrl).toBe(targetUrl);
    });

    it('enforces idempotency and never charges credits twice on duplicate submissions', async () => {
      const targetUrl = `https://example.com/idempotent-doc-${Date.now()}.pdf`;
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(
          new Response(pdfBytes, {
            status: 200,
            headers: { 'Content-Type': 'application/pdf', 'Content-Length': '1024' },
          })
        );
      });

      const sharedKey = `idemp_shared_${Date.now()}`;

      // First submission
      const req1 = new NextRequest('http://localhost:3000/api/urls/fast-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [targetUrl],
          projectId: thirdPartyProject.id,
          idempotencyKey: sharedKey,
        }),
      });

      const res1 = await postFastIndex(req1);
      const data1 = await res1.json();
      expect(res1.status).toBe(200);

      const walletAfterFirst = await prisma.creditWallet.findUnique({
        where: { userId: customerUser.id },
      });
      const balanceAfterFirst = walletAfterFirst?.balance ?? 0;

      // Duplicate submission with exact same idempotencyKey
      const req2 = new NextRequest('http://localhost:3000/api/urls/fast-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [targetUrl],
          projectId: thirdPartyProject.id,
          idempotencyKey: sharedKey,
        }),
      });

      const res2 = await postFastIndex(req2);
      const data2 = await res2.json();

      expect(res2.status).toBe(200);
      expect(data2.idempotent).toBe(true);

      // Verify wallet balance was NOT charged a second time
      const walletAfterSecond = await prisma.creditWallet.findUnique({
        where: { userId: customerUser.id },
      });
      expect(walletAfterSecond?.balance).toBe(balanceAfterFirst);
    });
  });
});
