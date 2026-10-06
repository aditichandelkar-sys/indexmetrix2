import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/db';
import { analyzeUrl } from '../src/lib/analyzer';
import { validateUrlForSSRF } from '../src/lib/ssrf';
import { findBestMatchingProperty } from '../src/lib/property-matcher';
import { GoogleIndexingApiAdapter } from '../src/lib/discovery/adapters/GoogleIndexingApiAdapter';
import { PublicDiscoveryAdapter } from '../src/lib/discovery/adapters/PublicDiscoveryAdapter';
import { GoogleSearchConsoleAdapter } from '../src/lib/discovery/adapters/GoogleSearchConsoleAdapter';
import { SearchVerificationAdapter } from '../src/lib/discovery/adapters/SearchVerificationAdapter';
import { executeDiscoveryPipeline } from '../src/lib/discovery/engine';
import { deductCredits, addCredits } from '../src/lib/credit-ledger';
import { POST as postUrls } from '../src/app/api/urls/route';
import { POST as postInspect } from '../src/app/api/urls/inspect/route';
import { POST as postAnalyze } from '../src/app/api/urls/analyze/route';
import * as auth from '../src/lib/auth';

const VALID_UUID = '4a2e5d91-7f83-4c6e-8d2b-1a9f0e3c5b78';
const THIRD_PARTY_URL = 'https://happyalone.proboards.com/thread/44393/ac-stopped-working-repair-services';
const OWNED_URL = 'https://www.indexmetrix.com/';

describe('Commercial URL Indexing & Discovery Engine Tests', () => {
  let customerUser: any;
  let ownerUser: any;
  let otherCustomerUser: any;
  let testProject: any;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    // 1. Fetch or create test customer
    customerUser = await prisma.user.findFirst({
      where: { email: 'customer@indexmatrix.io' },
      include: { wallet: true },
    });

    ownerUser = await prisma.user.findFirst({
      where: { role: 'OWNER' },
      include: { wallet: true },
    });

    // Ensure valid test project exists
    testProject = await prisma.project.findUnique({
      where: { id: VALID_UUID },
    });

    if (!testProject && customerUser) {
      testProject = await prisma.project.create({
        data: {
          id: VALID_UUID,
          userId: customerUser.id,
          name: 'Customer Production Workspace',
          domain: 'example.com',
        },
      });
    }

    // Mock authenticated user as customerUser by default
    vi.spyOn(auth, 'getSessionUser').mockResolvedValue(customerUser as any);

    // Mock WebSub external hub calls deterministically while letting other HTTP calls through
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url || '';
      if (urlStr.includes('pubsubhubbub.appspot.com')) {
        return new Response(null, { status: 204 });
      }
      return originalFetch(input, init);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. INVALID UUID REGRESSION & URL/PROJECT SEPARATION
  // =========================================================================
  describe('1. UUID Validation & Architecture Safeguards', () => {
    it('rejects submission when projectId is missing with clear user message', async () => {
      const req = new NextRequest('http://localhost:3000/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: THIRD_PARTY_URL,
          // projectId omitted
        }),
      });

      const res = await postUrls(req);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Please select a project before submitting a URL.');
    });

    it('rejects submission when projectId is empty string', async () => {
      const req = new NextRequest('http://localhost:3000/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: THIRD_PARTY_URL,
          projectId: '',
        }),
      });

      const res = await postUrls(req);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Please select a project before submitting a URL.');
    });

    it('rejects submission when projectId is malformed non-UUID (e.g. legacy "demo-project-1")', async () => {
      const req = new NextRequest('http://localhost:3000/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: THIRD_PARTY_URL,
          projectId: 'demo-project-1',
        }),
      });

      const res = await postUrls(req);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid project ID. Must be a valid UUID.');
    });

    it('safely rejects when URL string is accidentally passed as projectId', async () => {
      const req = new NextRequest('http://localhost:3000/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://example.com/another-page',
          projectId: 'https://happyalone.proboards.com/thread/44393/ac-stopped-working-repair-services',
        }),
      });

      const res = await postUrls(req);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid project ID. Must be a valid UUID.');
    });

    it('enforces tenant isolation: customer cannot submit to another customer\'s project UUID', async () => {
      const foreignProjectUuid = '9d7991cf-9768-4423-8e12-fbc32f291791'; // belongs to owner, not customerUser

      const req = new NextRequest('http://localhost:3000/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: THIRD_PARTY_URL,
          projectId: foreignProjectUuid,
        }),
      });

      const res = await postUrls(req);
      const data = await res.json();
      expect(res.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Project not found or unauthorized');
    });

    it('succeeds with valid third-party URL + valid project UUID', async () => {
      const req = new NextRequest('http://localhost:3000/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: THIRD_PARTY_URL,
          projectId: VALID_UUID,
        }),
      });

      const res = await postUrls(req);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.url).toBeDefined();
      expect(data.url.projectId).toBe(VALID_UUID);
      expect(data.url.normalizedUrl).toBe(THIRD_PARTY_URL);
    });
  });

  // =========================================================================
  // 2. THIRD-PARTY URL ACCEPTANCE & DISCOVERY PIPELINE
  // =========================================================================
  describe('2. Third-Party URL Acceptance & External Discovery Workflow', () => {
    it('accepts third-party forum URL and clearly distinguishes that GSC ownership is unavailable', async () => {
      const analysis = await analyzeUrl(THIRD_PARTY_URL);

      const discoveryResult = await executeDiscoveryPipeline({
        urlId: 'test-url-id-1',
        originalUrl: THIRD_PARTY_URL,
        normalizedUrl: THIRD_PARTY_URL,
        userId: customerUser.id,
        projectId: VALID_UUID,
        analysis,
        userProperties: [],
        matchedProperty: null,
      });

      expect(discoveryResult).toBeDefined();
      expect(discoveryResult.isOwnedProperty).toBe(false);
      expect(discoveryResult.overallStatus).toBe('DISCOVERY_PENDING');
      expect(discoveryResult.discoveryStatus).toBe('DISCOVERY_SIGNAL_SENT');
      expect(discoveryResult.explanations.some((e) => e.includes('Google Search Console verification is unavailable'))).toBe(true);
      expect(discoveryResult.overallStatus).not.toBe('INDEXED');
    }, 30000);

    it('never confuses "submitted" or "discovered" with "indexed"', async () => {
      const adapter = new PublicDiscoveryAdapter();
      const analysis = await analyzeUrl('https://example.com/');

      const result = await adapter.execute({
        urlId: 'test-url-2',
        originalUrl: 'https://example.com/',
        normalizedUrl: 'https://example.com/',
        userId: customerUser.id,
        projectId: VALID_UUID,
        analysis,
        userProperties: [],
      });

      expect(result.status).toBe('DISCOVERY_SIGNAL_SENT');
      expect(result.success).toBe(true);
      expect(result.provider).toBe('PUBLIC_DISCOVERY');
      expect(result.indexed).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.status).not.toBe('INDEXED');
      expect(result.status).not.toBe('INDEXED_CONFIRMED');
    }, 35000);
  });

  // =========================================================================
  // 3. PRE-FLIGHT TECHNICAL ANALYZER (POST /api/urls/analyze)
  // =========================================================================
  describe('3. Pre-Flight Technical SEO Analyzer Endpoint', () => {
    it('returns structured preflight technical information via POST /api/urls/analyze', async () => {
      const req = new NextRequest('http://localhost:3000/api/urls/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://www.indexmetrix.com/' }),
      });

      const res = await postAnalyze(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.analysis).toBeDefined();
      expect(data.analysis.url).toBe('https://www.indexmetrix.com/');
      expect(typeof data.analysis.httpStatus).toBe('number');
      expect(typeof data.analysis.reachable).toBe('boolean');
      expect(typeof data.analysis.robotsAllowed).toBe('boolean');
      expect(typeof data.analysis.noindex).toBe('boolean');
      expect(typeof data.analysis.canonicalMatches).toBe('boolean');
      expect(Array.isArray(data.analysis.sitemapUrls)).toBe(true);
      expect(Array.isArray(data.analysis.warnings)).toBe(true);
    });
  });

  // =========================================================================
  // 4. SSRF HARDENING
  // =========================================================================
  describe('4. SSRF Firewall & Target Validation', () => {
    it('blocks dangerous targets: localhost, loopback, private ranges, cloud metadata', async () => {
      const dangerous = [
        'http://localhost:3000/admin',
        'http://127.0.0.1:8080/',
        'http://0.0.0.0:80',
        'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.1/internal',
        'http://192.168.1.1/',
        'http://172.16.0.1/',
        'file:///etc/passwd',
        'ftp://example.com/resource',
      ];

      for (const target of dangerous) {
        const check = await validateUrlForSSRF(target);
        expect(check.isSafe, `Expected ${target} to be blocked by SSRF firewall`).toBe(false);
      }
    });

    it('rejects SSRF attempt directly in POST /api/urls', async () => {
      const req = new NextRequest('http://localhost:3000/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'http://127.0.0.1:3000/secret',
          projectId: VALID_UUID,
        }),
      });

      const res = await postUrls(req);
      const data = await res.json();
      expect(res.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.error).toContain('URL security policy violation');
    });
  });

  // =========================================================================
  // 5. GOOGLE INDEXING API STRICT RESTRICTION
  // =========================================================================
  describe('5. Google Indexing API Strict Restriction', () => {
    it('rejects ordinary third-party forum URL from Indexing API submission', async () => {
      const adapter = new GoogleIndexingApiAdapter();
      // Determine eligibility locally from page analysis without unnecessary real network request
      const forumAnalysis: any = {
        url: THIRD_PARTY_URL,
        httpStatus: 200,
        reachable: true,
        robotsAllowed: true,
        noindex: false,
        hasStructuredJob: false,
      };

      const result = await adapter.execute({
        urlId: 'test-forum-url',
        originalUrl: THIRD_PARTY_URL,
        normalizedUrl: THIRD_PARTY_URL,
        userId: customerUser.id,
        projectId: VALID_UUID,
        analysis: forumAnalysis,
        userProperties: [],
      });

      expect(result.status).toBe('NOT_ELIGIBLE');
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Google Indexing API is restricted to supported content types');
      expect(result.explanation).toContain('Google Indexing API is restricted to supported content types');
      expect(result.details.eligible).toBe(false);
    });

    it('marks JobPosting structured data as eligible for Indexing API', async () => {
      const adapter = new GoogleIndexingApiAdapter();
      const mockAnalysis: any = {
        hasStructuredJob: true,
      };

      expect(adapter.canHandle({ analysis: mockAnalysis } as any)).toBe(true);
    });
  });

  // =========================================================================
  // 6. SEARCH VERIFICATION ADAPTER
  // =========================================================================
  describe('6. Search Verification Behavior', () => {
    it('labels third-party URL search observation as "Public search observation" rather than GSC confirmed', async () => {
      const adapter = new SearchVerificationAdapter();
      const analysis = await analyzeUrl(THIRD_PARTY_URL);

      const outcome = await adapter.verify({
        urlId: 'test-url-id-verify',
        originalUrl: THIRD_PARTY_URL,
        normalizedUrl: THIRD_PARTY_URL,
        userId: customerUser.id,
        projectId: VALID_UUID,
        analysis,
        userProperties: [],
        matchedProperty: null,
      });

      expect(outcome.verificationMethod).toBe('PUBLIC_SEARCH_OBSERVATION');
      expect(outcome.explanation).toContain('Public search observation');
      expect(outcome.result).not.toBe('INDEXED_CONFIRMED');
    }, 30000);
  });

  // =========================================================================
  // 7. CREDIT ACCOUNTING & IDEMPOTENCY
  // =========================================================================
  describe('7. Credit Accounting & Idempotent Deductions', () => {
    it('correctly manages customer finite balance with idempotency key', async () => {
      const initialBalance = customerUser.wallet.balance;
      const idempotencyKey = `test_deduct_${Date.now()}`;

      // Deduct 1 credit
      const res1 = await deductCredits({
        userId: customerUser.id,
        amount: 1,
        operation: 'DISCOVERY_INSPECTION',
        idempotencyKey,
        reason: 'Automated test deduction',
      });

      expect(res1.success).toBe(true);
      expect(res1.balanceAfter).toBe(initialBalance - 1);

      // Repeat with same idempotency key (must not double charge)
      const res2 = await deductCredits({
        userId: customerUser.id,
        amount: 1,
        operation: 'DISCOVERY_INSPECTION',
        idempotencyKey,
        reason: 'Automated test duplicate call',
      });

      expect(res2.success).toBe(true);
      expect(res2.balanceAfter).toBe(initialBalance - 1);

      // Refund the 1 credit back
      await addCredits({
        userId: customerUser.id,
        amount: 1,
        type: 'REFUND',
        idempotencyKey: `test_refund_${Date.now()}`,
        reason: 'Cleanup test credit',
      });
    });

    it('respects Owner unlimited credit mode without deducting from finite wallet', async () => {
      const res = await deductCredits({
        userId: ownerUser.id,
        amount: 1,
        operation: 'DISCOVERY_INSPECTION',
        idempotencyKey: `owner_test_${Date.now()}`,
        reason: 'Owner discovery execution',
      });

      expect(res.success).toBe(true);
      expect(res.unlimited).toBe(true);
      expect(res.isUnlimited).toBe(true);
      expect(res.amountDeducted).toBe(0);
    });
  });
});
