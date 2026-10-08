import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/db';
import { POST as postSubmit } from '../src/app/api/urls/submit/route';
import { POST as postInspect } from '../src/app/api/urls/inspect/route';
import { GET as getJobs } from '../src/app/api/jobs/route';
import * as auth from '../src/lib/auth';

const THIRD_PARTY_PROJECT_ID = '8f3b2a1c-9d4e-4f5a-b6c7-2e1d0f9a8b7c';
const OWNED_PROJECT_ID = '4a2e5d91-7f83-4c6e-8d2b-1a9f0e3c5b78';
const THIRD_PARTY_URL = 'https://happyalone.proboards.com/thread/44393/ac-stopped-working-repair-services';
const OWNED_URL = 'https://example.com/blog/seo-checklist';
const UNAUTHORIZED_OWNED_URL = 'https://example.org/unauthorized-page';

describe('Third-Party URL Indexing Flow & GSC Separation', () => {
  let customerUser: any;
  let thirdPartyProject: any;
  let ownedProject: any;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;

    // 1. Fetch test customer
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

    // 2. Ensure third-party project exists
    thirdPartyProject = await prisma.project.upsert({
      where: { id: THIRD_PARTY_PROJECT_ID },
      update: {},
      create: {
        id: THIRD_PARTY_PROJECT_ID,
        userId: customerUser.id,
        name: '3rd-Party & External Links',
        domain: 'third-party-links.io',
        description: 'Automated workspace for 3rd-party URLs, backlinks, forums, and external content indexing.',
      },
    });

    // 3. Ensure owned project exists
    ownedProject = await prisma.project.upsert({
      where: { id: OWNED_PROJECT_ID },
      update: {},
      create: {
        id: OWNED_PROJECT_ID,
        userId: customerUser.id,
        name: 'Example Commerce Blog',
        domain: 'example.com',
        description: 'Primary corporate blog & technical content hub',
      },
    });

    // 4. Ensure an active Google Account and verified Search Console property exists for example.com
    let googleAccount = await prisma.googleAccount.findFirst({
      where: { userId: customerUser.id },
    });

    if (!googleAccount) {
      googleAccount = await prisma.googleAccount.create({
        data: {
          userId: customerUser.id,
          email: 'owner@example.com',
          encryptedAccessToken: 'mock_token',
          tokenExpiresAt: new Date(Date.now() + 3600000),
          scopes: 'https://www.googleapis.com/auth/webmasters.readonly',
          status: 'ACTIVE',
        },
      });
    }

    await prisma.searchConsoleProperty.upsert({
      where: { id: 'prop-example-com' },
      update: { isVerified: true },
      create: {
        id: 'prop-example-com',
        googleAccountId: googleAccount.id,
        projectId: ownedProject.id,
        propertyUrl: 'sc-domain:example.com',
        permissionLevel: 'siteOwner',
        isVerified: true,
      },
    });

    // Mock IndexInstantly API key
    process.env.INDEXINSTANTLY_API_KEY = 'ii_live_test_secret_key';

    // Mock authenticated user
    vi.spyOn(auth, 'getSessionUser').mockResolvedValue(customerUser as any);

    // Mock external network calls to avoid hitting live APIs
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url || '';
      if (urlStr.includes('indexinstantly')) {
        if (urlStr.includes('/index')) {
          return new Response(
            JSON.stringify({
              batch_id: 'btch_test_9a_123',
              accepted: 1,
              blocked: 0,
              duplicates: 0,
              duplicate_urls: [],
              status: 'queued',
              remaining_credits: 5000,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        if (urlStr.includes('/batch/')) {
          return new Response(
            JSON.stringify({
              batch_id: 'btch_test_9a_123',
              status: 'queued',
              accepted: 1,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
      }
      if (urlStr.includes('pubsubhubbub') || urlStr.includes('indexnow.org')) {
        return new Response(null, { status: 200 });
      }
      return new Response('<html><head><title>Mocked Page</title></head><body>Content</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
  });

  afterEach(() => {
    delete process.env.INDEXINSTANTLY_API_KEY;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Requirement 9a: third-party URL submission succeeds without GSC property coverage
  // =========================================================================
  it('9a: accepts public third-party URL without requiring GSC property coverage', async () => {
    const req = new NextRequest('http://localhost:3000/api/urls/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: THIRD_PARTY_URL,
        projectId: thirdPartyProject.id,
      }),
    });

    const res = await postSubmit(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.submissionType).toBe('THIRD_PARTY_DISCOVERY');
    expect(data.url).toBeDefined();
    expect(data.url.normalizedUrl).toBe(THIRD_PARTY_URL);
    expect(data.url.matchedPropertyId).toBeNull();
    expect(data.url.provider).toBe('INDEXINSTANTLY');
    expect(data.url.providerBatchId).toBe('btch_test_9a_123');
    expect(data.job).toBeDefined();
    expect(data.job.type).toBe('DISCOVERY_AND_INSPECTION');
  });

  // =========================================================================
  // Requirement 9b: owned URL still uses GSC validation
  // =========================================================================
  it('9b: owned project rejects submission when URL is not covered by authorized GSC property', async () => {
    const req = new NextRequest('http://localhost:3000/api/urls/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: UNAUTHORIZED_OWNED_URL,
        projectId: ownedProject.id,
      }),
    });

    const res = await postSubmit(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('PROPERTY_NOT_AUTHORIZED');
    expect(data.error.message).toContain('not covered by any authorized Google Search Console property');
  });

  it('9b: owned project succeeds when URL is covered by authorized GSC property', async () => {
    const req = new NextRequest('http://localhost:3000/api/urls/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: OWNED_URL,
        projectId: ownedProject.id,
      }),
    });

    const res = await postSubmit(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.submissionType).toBe('OWNED_GSC');
    expect(data.url.matchedPropertyId).toBe('prop-example-com');
  });

  // =========================================================================
  // Requirement 9c: third-party URL cannot call GSC inspection
  // =========================================================================
  it('9c: rejects GSC URL Inspection call for third-party URLs and projects', async () => {
    const req = new NextRequest('http://localhost:3000/api/urls/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: THIRD_PARTY_URL,
        projectId: thirdPartyProject.id,
      }),
    });

    const res = await postInspect(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('PROPERTY_NOT_AUTHORIZED');
    expect(data.error.message).toContain('Google URL Inspection is only available for verified owned properties');
  });

  // =========================================================================
  // Requirement 9d: SSRF protection remains enabled
  // =========================================================================
  it('9d: SSRF protection blocks loopback, private IPs, and cloud metadata targets', async () => {
    const ssrfPayloads = [
      'http://127.0.0.1:8080/api/secret',
      'http://localhost:3000/admin',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/internal',
    ];

    for (const target of ssrfPayloads) {
      const req = new NextRequest('http://localhost:3000/api/urls/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: target,
          projectId: thirdPartyProject.id,
        }),
      });

      const res = await postSubmit(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('SSRF_BLOCKED');
      expect(data.error.message).toContain('URL security policy violation');
    }
  });

  // =========================================================================
  // Requirement 9e: BullMQ job is created correctly
  // =========================================================================
  it('9e: creates batch indexing BullMQ job with correct item linkage and exposed in Jobs Center', async () => {
    const uniqueThirdPartyUrl = `https://happyalone.proboards.com/thread/test-${Date.now()}`;
    const req = new NextRequest('http://localhost:3000/api/urls/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: uniqueThirdPartyUrl,
        projectId: thirdPartyProject.id,
      }),
    });

    const res = await postSubmit(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.job).toBeDefined();

    const createdJobId = data.job.id;

    // Verify job in database
    const dbJob = await prisma.indexingJob.findUnique({
      where: { id: createdJobId },
      include: { items: true },
    });

    expect(dbJob).toBeDefined();
    expect(dbJob?.projectId).toBe(thirdPartyProject.id);
    expect(dbJob?.type).toBe('DISCOVERY_AND_INSPECTION');
    expect(dbJob?.totalUrls).toBe(1);
    expect(dbJob?.items.length).toBe(1);
    expect(dbJob?.items[0].urlId).toBe(data.url.id);

    // Verify job is queryable via GET /api/jobs
    const jobsReq = new NextRequest(`http://localhost:3000/api/jobs?projectId=${thirdPartyProject.id}`);
    const jobsRes = await getJobs(jobsReq);
    const jobsData = await jobsRes.json();

    expect(jobsRes.status).toBe(200);
    expect(jobsData.success).toBe(true);
    const foundJob = jobsData.jobs.find((j: any) => j.id === createdJobId);
    expect(foundJob).toBeDefined();
    expect(foundJob.project.name).toBe('3rd-Party & External Links');
  });
});
