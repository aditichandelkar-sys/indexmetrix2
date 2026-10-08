import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/db';
import { submitUrls, getBatchStatus, normalizeProviderStatus } from '../src/lib/indexinstantly';
import { POST as postSubmit } from '../src/app/api/urls/submit/route';
import { processBatchIndexingJob } from '../src/lib/queue';
import * as auth from '../src/lib/auth';

const TEST_API_KEY = 'ii_live_mock_secret_key_12345';
const THIRD_PARTY_PROJECT_ID = '33333333-3333-4333-a333-333333333333';
const OWNED_PROJECT_ID = '55555555-5555-4555-a555-555555555555';

describe('IndexInstantly API Integration & Worker Monitoring', () => {
  let customerUser: any;
  let thirdPartyProject: any;
  let ownedProject: any;

  beforeEach(async () => {
    process.env.INDEXINSTANTLY_API_KEY = TEST_API_KEY;

    customerUser = await prisma.user.findFirst({
      where: { email: 'indexinstantly_tester@indexmatrix.io' },
    });

    if (!customerUser) {
      customerUser = await prisma.user.create({
        data: {
          email: 'indexinstantly_tester@indexmatrix.io',
          passwordHash: 'dummy_hash',
          name: 'IndexInstantly Tester',
          role: 'CUSTOMER',
          wallet: { create: { balance: 100 } },
        },
      });
    }

    thirdPartyProject = await prisma.project.upsert({
      where: { id: THIRD_PARTY_PROJECT_ID },
      update: {},
      create: {
        id: THIRD_PARTY_PROJECT_ID,
        userId: customerUser.id,
        name: 'Third Party Links',
        domain: 'third-party-links.io',
      },
    });

    ownedProject = await prisma.project.upsert({
      where: { id: OWNED_PROJECT_ID },
      update: {},
      create: {
        id: OWNED_PROJECT_ID,
        userId: customerUser.id,
        name: 'Owned SEO Site',
        domain: 'example.com',
      },
    });

    // Mock authenticated user
    vi.spyOn(auth, 'getSessionUser').mockResolvedValue(customerUser as any);
  });

  afterEach(() => {
    delete process.env.INDEXINSTANTLY_API_KEY;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Direct submitUrls & getBatchStatus API Client Tests
  // =========================================================================
  describe('IndexInstantly API Client (src/lib/indexinstantly.ts)', () => {
    it('sends POST request to IndexInstantly with Bearer token authentication', async () => {
      let capturedUrl = '';
      let capturedHeaders: any = null;
      let capturedBody: any = null;

      vi.spyOn(global, 'fetch').mockImplementation(async (url: any, init?: any) => {
        capturedUrl = String(url);
        capturedHeaders = init?.headers;
        capturedBody = JSON.parse(init?.body);

        return new Response(
          JSON.stringify({
            batch_id: 'btch_test_abc_1',
            accepted: 1,
            blocked: 0,
            duplicates: 0,
            duplicate_urls: [],
            status: 'queued',
            remaining_credits: 9500,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      });

      const res = await submitUrls(['https://forum.example.org/thread-100']);

      expect(res.success).toBe(true);
      expect(capturedUrl).toBe('https://www.indexinstantly.com/wp-json/indexinstantly/v1/index');
      expect(capturedHeaders['Authorization']).toBe(`Bearer ${TEST_API_KEY}`);
      expect(capturedHeaders['Content-Type']).toBe('application/json');
      expect(capturedBody.urls).toEqual(['https://forum.example.org/thread-100']);
      expect(res.data?.batch_id).toBe('btch_test_abc_1');
      expect(res.data?.status).toBe('queued');
    });

    it('handles missing API key gracefully without crashing', async () => {
      delete process.env.INDEXINSTANTLY_API_KEY;

      const res = await submitUrls(['https://example.com/item']);

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('MISSING_API_KEY');
      expect(res.error?.statusCode).toBe(503);
    });

    it('handles 401 invalid API key from provider safely', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return new Response(JSON.stringify({ code: 'rest_forbidden', message: 'Sorry, you are not allowed to do that.' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      });

      const res = await submitUrls(['https://example.com/item']);

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('INVALID_API_KEY');
      expect(res.error?.statusCode).toBe(401);
    });

    it('handles 402 insufficient credits safely', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return new Response(JSON.stringify({ code: 'insufficient_credits', message: 'You need more credits.' }), {
          status: 402,
          headers: { 'content-type': 'application/json' },
        });
      });

      const res = await submitUrls(['https://example.com/item']);

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('INSUFFICIENT_CREDITS');
      expect(res.error?.statusCode).toBe(402);
    });

    it('handles 429 rate limit with Retry-After header', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '45',
          },
        });
      });

      const res = await submitUrls(['https://example.com/item']);

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(res.error?.statusCode).toBe(429);
      expect(res.error?.retryAfterSeconds).toBe(45);
    });

    it('queries batch status and normalizes statuses accurately', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('batch_1')) {
          return new Response(JSON.stringify({ batch_id: 'batch_1', status: 'queued', accepted: 1 }), { status: 200 });
        }
        if (urlStr.includes('batch_2')) {
          return new Response(JSON.stringify({ batch_id: 'batch_2', status: 'processing', accepted: 1 }), { status: 200 });
        }
        if (urlStr.includes('batch_3')) {
          return new Response(JSON.stringify({ batch_id: 'batch_3', status: 'indexed', accepted: 1 }), { status: 200 });
        }
        if (urlStr.includes('batch_4')) {
          return new Response(JSON.stringify({ batch_id: 'batch_4', status: 'failed', accepted: 1, error: 'Target unreachable' }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      });

      const res1 = await getBatchStatus('batch_1');
      expect(res1.data?.status).toBe('queued');
      expect(res1.data?.normalizedStatus).toBe('SUBMITTED');

      const res2 = await getBatchStatus('batch_2');
      expect(res2.data?.status).toBe('processing');
      expect(res2.data?.normalizedStatus).toBe('PROCESSING');

      const res3 = await getBatchStatus('batch_3');
      expect(res3.data?.status).toBe('indexed');
      expect(res3.data?.normalizedStatus).toBe('INDEXED');

      const res4 = await getBatchStatus('batch_4');
      expect(res4.data?.status).toBe('failed');
      expect(res4.data?.normalizedStatus).toBe('FAILED');
    });

    it('normalizeProviderStatus strictly preserves distinction between submitted and indexed', () => {
      expect(normalizeProviderStatus('queued')).toBe('SUBMITTED');
      expect(normalizeProviderStatus('pending')).toBe('SUBMITTED');
      expect(normalizeProviderStatus('duplicate')).toBe('SUBMITTED');
      expect(normalizeProviderStatus('processing')).toBe('PROCESSING');
      expect(normalizeProviderStatus('indexed')).toBe('INDEXED');
      expect(normalizeProviderStatus('success')).toBe('INDEXED');
      expect(normalizeProviderStatus('failed')).toBe('FAILED');
      expect(normalizeProviderStatus('refused')).toBe('FAILED');
      expect(normalizeProviderStatus('blocked')).toBe('BLOCKED');
    });
  });

  // =========================================================================
  // 2. Third-Party URL Submission Route (/api/urls/submit)
  // =========================================================================
  describe('Submission Route Integration (POST /api/urls/submit)', () => {
    it('submits third-party URL to IndexInstantly, persists batch ID, and does NOT mark as INDEXED', async () => {
      const targetUrl = `https://happyalone.proboards.com/thread/${Date.now()}`;
      const mockBatchId = `btch_${Date.now()}`;

      vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/index')) {
          return new Response(
            JSON.stringify({
              batch_id: mockBatchId,
              accepted: 1,
              status: 'queued',
              remaining_credits: 8000,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(null, { status: 200 });
      });

      const req = new NextRequest('http://localhost:3000/api/urls/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          projectId: thirdPartyProject.id,
        }),
      });

      const res = await postSubmit(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.submissionType).toBe('THIRD_PARTY_DISCOVERY');
      expect(data.batchId).toBe(mockBatchId);
      expect(data.provider).toBe('INDEXINSTANTLY');

      // Verify in database: URL is marked SUBMITTED with provider metadata, NOT INDEXED
      const dbUrl: any = await prisma.url.findUnique({
        where: { id: data.url.id },
      });

      expect(dbUrl?.status).toBe('SUBMITTED');
      expect(dbUrl?.status).not.toBe('INDEXED');
      expect(dbUrl?.provider).toBe('INDEXINSTANTLY');
      expect(dbUrl?.providerBatchId).toBe(mockBatchId);
      expect(dbUrl?.providerStatus).toBe('queued');
      expect(dbUrl?.submittedAt).toBeDefined();

      // Verify status history
      const history = await prisma.urlStatusHistory.findFirst({
        where: { urlId: dbUrl?.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(history?.newStatus).toBe('SUBMITTED');
      expect(history?.source).toBe('INDEXINSTANTLY');
      expect(history?.reason).toContain(mockBatchId);
    });

    it('returns safe application error when API key is missing without crashing', async () => {
      delete process.env.INDEXINSTANTLY_API_KEY;

      const req = new NextRequest('http://localhost:3000/api/urls/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `https://happyalone.proboards.com/thread/missing-key-${Date.now()}`,
          projectId: thirdPartyProject.id,
        }),
      });

      const res = await postSubmit(req);
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('MISSING_API_KEY');
      expect(data.error.message).toContain('INDEXINSTANTLY_API_KEY');
    });
  });

  // =========================================================================
  // 3. Worker Background Status Monitoring (processBatchIndexingJob)
  // =========================================================================
  describe('Worker Asynchronous Status Polling', () => {
    it('updates URL status to PROCESSING when IndexInstantly returns processing', async () => {
      const targetUrl = `https://forum.test.org/post-${Date.now()}`;
      const batchId = `btch_poll_proc_${Date.now()}`;

      // Create URL and Job
      const urlRecord = await prisma.url.create({
        data: {
          projectId: thirdPartyProject.id,
          originalUrl: targetUrl,
          normalizedUrl: targetUrl,
          hostname: 'forum.test.org',
          path: '/post-1',
          status: 'SUBMITTED',
          provider: 'INDEXINSTANTLY',
          providerBatchId: batchId,
          providerStatus: 'queued',
        } as any,
      });

      const jobRecord = await prisma.indexingJob.create({
        data: {
          userId: customerUser.id,
          projectId: thirdPartyProject.id,
          type: 'DISCOVERY_AND_INSPECTION',
          status: 'QUEUED',
          totalUrls: 1,
          queuedUrls: 1,
          metadata: JSON.stringify({ provider: 'INDEXINSTANTLY', batchId }),
          items: {
            create: {
              urlId: urlRecord.id,
              status: 'QUEUED',
            },
          },
        },
      });

      // Mock IndexInstantly returning "processing"
      vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes(`/batch/${batchId}`)) {
          return new Response(
            JSON.stringify({
              batch_id: batchId,
              status: 'processing',
              accepted: 1,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response('<html><head><title>Ok</title></head></html>', { status: 200 });
      });

      await processBatchIndexingJob(jobRecord.id);

      const updatedUrl: any = await prisma.url.findUnique({ where: { id: urlRecord.id } });
      expect(updatedUrl?.status).toBe('PROCESSING');
      expect(updatedUrl?.providerStatus).toBe('processing');

      const updatedJob = await prisma.indexingJob.findUnique({ where: { id: jobRecord.id } });
      expect(updatedJob?.status).toBe('PROCESSING');
    });

    it('updates URL status to INDEXED when IndexInstantly confirms indexed', async () => {
      const targetUrl = `https://forum.test.org/post-indexed-${Date.now()}`;
      const batchId = `btch_poll_done_${Date.now()}`;

      const urlRecord = await prisma.url.create({
        data: {
          projectId: thirdPartyProject.id,
          originalUrl: targetUrl,
          normalizedUrl: targetUrl,
          hostname: 'forum.test.org',
          path: '/post-indexed',
          status: 'SUBMITTED',
          provider: 'INDEXINSTANTLY',
          providerBatchId: batchId,
          providerStatus: 'processing',
        } as any,
      });

      const jobRecord = await prisma.indexingJob.create({
        data: {
          userId: customerUser.id,
          projectId: thirdPartyProject.id,
          type: 'DISCOVERY_AND_INSPECTION',
          status: 'QUEUED',
          totalUrls: 1,
          queuedUrls: 1,
          metadata: JSON.stringify({ provider: 'INDEXINSTANTLY', batchId }),
          items: {
            create: {
              urlId: urlRecord.id,
              status: 'QUEUED',
            },
          },
        },
      });

      // Mock IndexInstantly returning "indexed"
      vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes(`/batch/${batchId}`)) {
          return new Response(
            JSON.stringify({
              batch_id: batchId,
              status: 'indexed',
              accepted: 1,
              completed: 1,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response('<html><head><title>Ok</title></head></html>', { status: 200 });
      });

      await processBatchIndexingJob(jobRecord.id);

      const updatedUrl: any = await prisma.url.findUnique({ where: { id: urlRecord.id } });
      expect(updatedUrl?.status).toBe('INDEXED');
      expect(updatedUrl?.providerStatus).toBe('indexed');
      expect(updatedUrl?.lastIndexedAt).toBeDefined();

      const updatedJob = await prisma.indexingJob.findUnique({ where: { id: jobRecord.id } });
      expect(updatedJob?.status).toBe('COMPLETED');
      expect(updatedJob?.completedUrls).toBe(1);
    });

    it('updates URL status to FAILED when IndexInstantly reports failure', async () => {
      const targetUrl = `https://forum.test.org/post-fail-${Date.now()}`;
      const batchId = `btch_poll_fail_${Date.now()}`;

      const urlRecord = await prisma.url.create({
        data: {
          projectId: thirdPartyProject.id,
          originalUrl: targetUrl,
          normalizedUrl: targetUrl,
          hostname: 'forum.test.org',
          path: '/post-fail',
          status: 'SUBMITTED',
          provider: 'INDEXINSTANTLY',
          providerBatchId: batchId,
          providerStatus: 'processing',
        } as any,
      });

      const jobRecord = await prisma.indexingJob.create({
        data: {
          userId: customerUser.id,
          projectId: thirdPartyProject.id,
          type: 'DISCOVERY_AND_INSPECTION',
          status: 'QUEUED',
          totalUrls: 1,
          queuedUrls: 1,
          metadata: JSON.stringify({ provider: 'INDEXINSTANTLY', batchId }),
          items: {
            create: {
              urlId: urlRecord.id,
              status: 'QUEUED',
            },
          },
        },
      });

      // Mock IndexInstantly returning "failed"
      vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes(`/batch/${batchId}`)) {
          return new Response(
            JSON.stringify({
              batch_id: batchId,
              status: 'failed',
              error: 'Target URL 404 Not Found',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response('<html><head><title>Ok</title></head></html>', { status: 200 });
      });

      await processBatchIndexingJob(jobRecord.id);

      const updatedUrl: any = await prisma.url.findUnique({ where: { id: urlRecord.id } });
      expect(updatedUrl?.status).toBe('FAILED');
      expect(updatedUrl?.providerStatus).toBe('failed');
      expect(updatedUrl?.providerError).toBe('Target URL 404 Not Found');

      const updatedJob = await prisma.indexingJob.findUnique({ where: { id: jobRecord.id } });
      expect(updatedJob?.status).toBe('FAILED');
      expect(updatedJob?.failedUrls).toBe(1);
    });
  });
});
