import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/db';
import { POST as postInspect } from '../src/app/api/urls/inspect/route';
import { POST as postSubmit } from '../src/app/api/urls/submit/route';
import { POST as postSync } from '../src/app/api/google/sync/route';
import { POST as postLinkProperty } from '../src/app/api/google/properties/route';
import * as auth from '../src/lib/auth';
import * as googleClient from '../src/lib/google-client';
import { encryptText, decryptText } from '../src/lib/crypto';

const HVAC_PROJECT_ID = '9b1c2d3e-4f5a-4b7c-8d9e-0f1a2b3c4d5e';
const THIRD_PARTY_PROJECT_ID = '7c8d9e0f-1a2b-4c4d-8e6f-7a8b9c0d1e2f';
const OWNED_URL = 'https://indexmetrix.com/';
const UNAUTHORIZED_URL = 'https://example.org/some-page';
const THIRD_PARTY_URL = 'https://lewesfc.proboards.com/thread/9591/frozen-evaporator-coil-repair-services';

describe('Google Search Console Owned Integration & Verification', () => {
  let testUser: any;
  let googleAccount: any;
  let hvacProject: any;
  let thirdPartyProject: any;
  let scProperty: any;

  beforeEach(async () => {
    // 1. Ensure test user
    testUser = await prisma.user.findFirst({
      where: { email: 'owner@indexmetrix.com' },
      include: { wallet: true },
    });

    if (!testUser) {
      testUser = await prisma.user.create({
        data: {
          email: 'owner@indexmetrix.com',
          passwordHash: 'dummyhash',
          name: 'Index Metrix Admin',
          role: 'OWNER',
          creditMode: 'UNLIMITED',
        },
      });
    }

    vi.spyOn(auth, 'getSessionUser').mockResolvedValue({
      id: testUser.id,
      email: testUser.email,
      name: testUser.name,
      role: testUser.role,
      creditMode: testUser.creditMode,
    } as any);

    // 2. Persist Google Account with encrypted tokens
    const sampleAccessToken = 'ya29.sample_valid_access_token_123';
    const sampleRefreshToken = '1//0g_sample_refresh_token_456';

    googleAccount = await prisma.googleAccount.findFirst({
      where: { userId: testUser.id, email: 'admin@indexmetrix.com' },
    });

    if (!googleAccount) {
      googleAccount = await prisma.googleAccount.create({
        data: {
          userId: testUser.id,
          email: 'admin@indexmetrix.com',
          encryptedAccessToken: encryptText(sampleAccessToken),
          encryptedRefreshToken: encryptText(sampleRefreshToken),
          tokenExpiresAt: new Date(Date.now() + 3600000),
          scopes: 'openid email profile https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/indexing',
          status: 'ACTIVE',
        },
      });
    } else {
      googleAccount = await prisma.googleAccount.update({
        where: { id: googleAccount.id },
        data: {
          encryptedAccessToken: encryptText(sampleAccessToken),
          encryptedRefreshToken: encryptText(sampleRefreshToken),
          status: 'ACTIVE',
        },
      });
    }

    // 3. Upsert hvac project (indexmetrix.com)
    hvacProject = await prisma.project.upsert({
      where: { id: HVAC_PROJECT_ID },
      update: {},
      create: {
        id: HVAC_PROJECT_ID,
        userId: testUser.id,
        name: 'hvac',
        domain: 'indexmetrix.com',
        description: 'HVAC portal on indexmetrix.com',
      },
    });

    // 4. Upsert 3rd-party project
    thirdPartyProject = await prisma.project.upsert({
      where: { id: THIRD_PARTY_PROJECT_ID },
      update: {},
      create: {
        id: THIRD_PARTY_PROJECT_ID,
        userId: testUser.id,
        name: '3rd-Party & External Links',
        domain: 'third-party-links.io',
        description: 'Third party discovery workspace',
      },
    });

    // 5. Upsert authorized Search Console property: sc-domain:indexmetrix.com
    scProperty = await prisma.searchConsoleProperty.upsert({
      where: {
        googleAccountId_propertyUrl: {
          googleAccountId: googleAccount.id,
          propertyUrl: 'sc-domain:indexmetrix.com',
        },
      },
      update: {
        projectId: hvacProject.id,
        isVerified: true,
      },
      create: {
        googleAccountId: googleAccount.id,
        propertyUrl: 'sc-domain:indexmetrix.com',
        permissionLevel: 'siteOwner',
        isVerified: true,
        projectId: hvacProject.id,
      },
    });

    // Also link to hvacProject
    await prisma.project.update({
      where: { id: hvacProject.id },
      data: {
        googlePropertyId: scProperty.id,
        googlePropertyUrl: scProperty.propertyUrl,
      },
    });

    process.env.INDEXINSTANTLY_API_KEY = 'ii_live_mock_gsc_test_key';

    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url || '';
      if (urlStr.includes('indexinstantly')) {
        return new Response(
          JSON.stringify({
            batch_id: 'btch_test_gsc_123',
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
      return new Response('<html><head><title>Mocked</title></head></html>', { status: 200 });
    });
  });

  afterEach(() => {
    delete process.env.INDEXINSTANTLY_API_KEY;
    vi.restoreAllMocks();
  });

  it('a. Google OAuth connection persists and encrypted tokens are retrievable', async () => {
    const account = await prisma.googleAccount.findUnique({
      where: { id: googleAccount.id },
    });

    expect(account).toBeDefined();
    expect(account?.status).toBe('ACTIVE');
    expect(account?.encryptedAccessToken).toBeDefined();
    expect(account?.encryptedRefreshToken).toBeDefined();

    // Verify AES-256 decryption succeeds
    const decryptedAccess = decryptText(account!.encryptedAccessToken);
    const decryptedRefresh = decryptText(account!.encryptedRefreshToken!);
    expect(decryptedAccess).toBe('ya29.sample_valid_access_token_123');
    expect(decryptedRefresh).toBe('1//0g_sample_refresh_token_456');
  });

  it('b. authorized GSC properties sync successfully from Google Sites API', async () => {
    // Mock Google listSearchConsoleProperties
    vi.spyOn(googleClient, 'listSearchConsoleProperties').mockResolvedValue([
      { siteUrl: 'sc-domain:indexmetrix.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://www.indexmetrix.com/', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:v1.indexmetrix.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://craftpeak.site/', permissionLevel: 'siteOwner' },
    ]);

    const req = new NextRequest('http://localhost:3000/api/google/sync', {
      method: 'POST',
      body: JSON.stringify({ accountId: googleAccount.id }),
    });

    const res = await postSync(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    // Verify all 4 properties exist in database
    const dbProperties = await prisma.searchConsoleProperty.findMany({
      where: { googleAccountId: googleAccount.id },
    });
    const propUrls = dbProperties.map((p) => p.propertyUrl);
    expect(propUrls).toContain('sc-domain:indexmetrix.com');
    expect(propUrls).toContain('https://www.indexmetrix.com/');
    expect(propUrls).toContain('sc-domain:v1.indexmetrix.com');
    expect(propUrls).toContain('https://craftpeak.site/');
  });

  it('c. owned project property matches correctly (hvac -> indexmetrix.com -> sc-domain:indexmetrix.com)', async () => {
    const project = await prisma.project.findUnique({
      where: { id: hvacProject.id },
      include: { properties: true },
    });

    expect(project).toBeDefined();
    expect(project?.domain).toBe('indexmetrix.com');
    expect(project?.googlePropertyUrl).toBe('sc-domain:indexmetrix.com');

    // Property matching verification
    const { matchesSearchConsoleProperty } = await import('../src/lib/property-matcher');
    expect(matchesSearchConsoleProperty('https://indexmetrix.com/', 'sc-domain:indexmetrix.com')).toBe(true);
    expect(matchesSearchConsoleProperty('https://www.indexmetrix.com/', 'sc-domain:indexmetrix.com')).toBe(true);
    expect(matchesSearchConsoleProperty('https://indexmetrix.com/services', 'sc-domain:indexmetrix.com')).toBe(true);
  });

  it('d. owned URL calls the real GSC inspection path and persists real Google telemetry', async () => {
    // Mock inspectUrlWithGoogle returning real Search Console response shape
    const mockInspectSpy = vi.spyOn(googleClient, 'inspectUrlWithGoogle').mockResolvedValue({
      inspectionResult: {
        verdict: 'PASS',
        coverageState: 'Submitted and indexed',
        robotsTxtState: 'ALLOWED',
        indexingState: 'INDEXING_ALLOWED',
        pageFetchState: 'SUCCESSFUL',
        googleCanonical: 'https://indexmetrix.com/',
        userCanonical: 'https://indexmetrix.com/',
        crawledAs: 'MOBILE',
        lastCrawlTime: '2026-10-06T12:00:00Z',
        referringUrls: ['https://indexmetrix.com/sitemap.xml'],
      },
      inspectionResultLink: 'https://search.google.com/search-console/inspect?resource_id=sc-domain:indexmetrix.com&id=123',
      raw: { inspectionResult: { indexStatusResult: { verdict: 'PASS' } } },
    });

    const req = new NextRequest('http://localhost:3000/api/urls/inspect', {
      method: 'POST',
      body: JSON.stringify({
        url: OWNED_URL,
        projectId: hvacProject.id,
      }),
    });

    const res = await postInspect(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.status).toBe('INDEXED');
    expect(data.matchedProperty.propertyUrl).toBe('sc-domain:indexmetrix.com');
    expect(data.inspection).toBeDefined();
    expect(data.inspection.verdict).toBe('PASS');
    expect(data.inspection.coverageState).toBe('Submitted and indexed');
    expect(data.inspection.robotsTxtState).toBe('ALLOWED');
    expect(data.inspection.pageFetchState).toBe('SUCCESSFUL');
    expect(data.inspection.lastCrawlTime).toBe('2026-10-06T12:00:00Z');
    expect(data.inspectionResultLink).toContain('search.google.com');

    // Verify inspectUrlWithGoogle was called with exact siteUrl: sc-domain:indexmetrix.com
    expect(mockInspectSpy).toHaveBeenCalledWith(
      googleAccount.id,
      'https://indexmetrix.com/',
      'sc-domain:indexmetrix.com'
    );

    // Verify database record persisted
    const savedInspection = await prisma.googleInspection.findFirst({
      where: { url: { normalizedUrl: 'https://indexmetrix.com/' } },
    });
    expect(savedInspection).toBeDefined();
    expect(savedInspection?.verdict).toBe('PASS');
    expect(savedInspection?.coverageState).toBe('Submitted and indexed');
  });

  it('e. unauthorized URL remains PROPERTY_NOT_AUTHORIZED', async () => {
    const req = new NextRequest('http://localhost:3000/api/urls/inspect', {
      method: 'POST',
      body: JSON.stringify({
        url: UNAUTHORIZED_URL,
        projectId: hvacProject.id,
      }),
    });

    const res = await postInspect(req);
    expect(res.status).toBe(400);
    const data = await res.json();

    expect(data.success).toBe(false);
    expect(data.error?.code).toBe('PROPERTY_NOT_AUTHORIZED');
    expect(data.error?.message).toContain('not covered by any authorized Google Search Console property');
  });

  it('f. third-party project cannot call GSC Inspect', async () => {
    const req = new NextRequest('http://localhost:3000/api/urls/inspect', {
      method: 'POST',
      body: JSON.stringify({
        url: THIRD_PARTY_URL,
        projectId: thirdPartyProject.id,
      }),
    });

    const res = await postInspect(req);
    expect(res.status).toBe(400);
    const data = await res.json();

    expect(data.success).toBe(false);
    expect(data.error?.code).toBe('PROPERTY_NOT_AUTHORIZED');
    expect(data.error?.message).toContain('third-party project and cannot be inspected via Google Search Console');
  });

  it('g. third-party discovery still works via /api/urls/submit', async () => {
    const req = new NextRequest('http://localhost:3000/api/urls/submit', {
      method: 'POST',
      body: JSON.stringify({
        url: THIRD_PARTY_URL,
        projectId: thirdPartyProject.id,
      }),
    });

    const res = await postSubmit(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.submissionType).toBe('THIRD_PARTY_DISCOVERY');
    expect(data.job).toBeDefined();
    expect(data.job.type).toBe('DISCOVERY_AND_INSPECTION');
  });
});
