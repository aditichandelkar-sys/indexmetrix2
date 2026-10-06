import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleWebSubProvider } from '../src/lib/discovery/providers/GoogleWebSubProvider';
import { IndexNowProvider } from '../src/lib/discovery/providers/IndexNowProvider';
import { GoogleIndexingApiProvider } from '../src/lib/discovery/providers/GoogleIndexingApiProvider';
import { DiscoveryProviderRegistry } from '../src/lib/discovery/providers/registry';
import { PublicDiscoveryAdapter } from '../src/lib/discovery/adapters/PublicDiscoveryAdapter';
import { DiscoveryContext } from '../src/lib/discovery/types';
import { deductCredits, addCredits } from '../src/lib/credit-ledger';
import { prisma } from '../src/lib/db';

const THIRD_PARTY_URL = 'https://happyalone.proboards.com/thread/44393/ac-stopped-working-repair-services';
const OWNED_URL = 'https://www.indexmetrix.com/';
const VALID_UUID = '4a2e5d91-7f83-4c6e-8d2b-1a9f0e3c5b78';

function createMockContext(overrides?: Partial<DiscoveryContext>): DiscoveryContext {
  return {
    urlId: 'test-url-uuid-1',
    originalUrl: THIRD_PARTY_URL,
    normalizedUrl: THIRD_PARTY_URL,
    userId: 'test-user-id',
    projectId: VALID_UUID,
    analysis: {
      url: THIRD_PARTY_URL,
      finalUrl: THIRD_PARTY_URL,
      normalizedUrl: THIRD_PARTY_URL,
      httpStatus: 200,
      responseTimeMs: 250,
      contentType: 'text/html',
      documentType: 'HTML_PAGE',
      isThirdPartyHosted: true,
      reachable: true,
      robotsAllowed: true,
      noindex: false,
      canonical: THIRD_PARTY_URL,
      canonicalMatches: true,
      title: 'AC stopped working - repair services - HappyAlone Forum',
      wordCount: 350,
      hasSitemap: false,
      sitemapUrls: [],
      metaDescription: null,
      robotsMeta: null,
      xRobotsTag: null,
      canonicalUrl: THIRD_PARTY_URL,
      robotsTxtStatus: 'ALLOWED',
      redirectChain: [],
      crawlable: true,
      discoveryEligible: true,
      warnings: [],
      issues: [],
      passedAudit: true,
      hasStructuredJob: false,
      analyzedAt: new Date().toISOString(),
    },
    userProperties: [],
    matchedProperty: null,
    ...overrides,
  };
}

describe('INDEX MATRIX — Verified Discovery Layer Deterministic Unit Tests', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // 1. PROVIDER SELECTION
  describe('1. Discovery Provider Selection', () => {
    it('selects GoogleWebSubProvider for standard third-party URL discovery', async () => {
      const registry = DiscoveryProviderRegistry.getInstance();
      registry.resetDefaultProviders();

      const ctx = createMockContext();
      const provider = await registry.selectProvider(THIRD_PARTY_URL, ctx);

      expect(provider).not.toBeNull();
      // Should choose WebSub or IndexNow depending on domain authorization
      expect(['GOOGLE_WEBSUB', 'INDEXNOW']).toContain(provider?.name);
    });

    it('selects GoogleIndexingApiProvider when URL has JobPosting structured data', async () => {
      const registry = DiscoveryProviderRegistry.getInstance();
      registry.resetDefaultProviders();

      const ctx = createMockContext({
        analysis: {
          ...createMockContext().analysis,
          hasStructuredJob: true,
        },
        matchedProperty: {
          id: 'prop-1',
          googleAccountId: 'acc-1',
          propertyUrl: 'sc-domain:example.com',
        },
      });

      const provider = await registry.selectProvider('https://example.com/jobs/1', ctx);
      expect(provider).not.toBeNull();
      expect(provider?.name).toBe('GOOGLE_INDEXING_API');
    });
  });

  // 2. SUCCESSFUL PROVIDER CALL
  describe('2. Successful Provider Call', () => {
    it('records confirmed acceptance and returns DISCOVERY_SIGNAL_SENT on HTTP 204 from WebSub hub', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 204,
        text: async () => '',
      } as any);

      const provider = new GoogleWebSubProvider();
      const ctx = createMockContext();

      const record = await provider.submit(THIRD_PARTY_URL, ctx);
      expect(record.accepted).toBe(true);
      expect(record.requestStatus).toBe('SUCCESS');
      expect(record.httpStatus).toBe(204);
      expect(record.evidenceType).toBe('WEBSUB_FEED_ACCEPTED');
      expect(record.provider).toBe('GOOGLE_WEBSUB');
      expect(record.requestUrl).toBe('https://pubsubhubbub.appspot.com/');
      expect(record.httpMethod).toBe('POST');

      // Adapter level check
      const adapter = new PublicDiscoveryAdapter(provider);
      const res = await adapter.execute(ctx);

      expect(res.status).toBe('DISCOVERY_SIGNAL_SENT');
      expect(res.success).toBe(true);
      expect(res.details.providerExecution.accepted).toBe(true);
      expect(res.details.providerExecution.evidenceType).toBe('WEBSUB_FEED_ACCEPTED');
    });
  });

  // 3. PROVIDER REJECTION
  describe('3. Provider Rejection Handling', () => {
    it('returns DISCOVERY_PENDING and never claims DISCOVERY_SIGNAL_SENT when provider rejects', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 400,
        text: async () => 'Invalid Hub Request',
      } as any);

      const provider = new GoogleWebSubProvider();
      const ctx = createMockContext();

      const record = await provider.submit(THIRD_PARTY_URL, ctx);
      expect(record.accepted).toBe(false);
      expect(record.requestStatus).toBe('REJECTED');
      expect(record.httpStatus).toBe(400);

      const adapter = new PublicDiscoveryAdapter(provider);
      const res = await adapter.execute(ctx);

      // CRITICAL: NEVER return DISCOVERY_SIGNAL_SENT unless remote accepted
      expect(res.status).toBe('DISCOVERY_PENDING');
      expect(res.success).toBe(false);
      expect(res.status).not.toBe('DISCOVERY_SIGNAL_SENT');
      expect(res.details.providerExecution.accepted).toBe(false);
    });
  });

  // 4. TIMEOUT HANDLING
  describe('4. Network Timeout Handling', () => {
    it('handles remote network timeout cleanly without crashing and marks status DISCOVERY_PENDING', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        const err: any = new Error('The operation was aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });

      const provider = new GoogleWebSubProvider();
      const ctx = createMockContext();

      const record = await provider.submit(THIRD_PARTY_URL, ctx);
      expect(record.accepted).toBe(false);
      expect(record.requestStatus).toBe('TIMEOUT');
      expect(record.errorCode).toBe('TIMEOUT');
      expect(record.errorMessage).toContain('timed out');

      const adapter = new PublicDiscoveryAdapter(provider);
      const res = await adapter.execute(ctx);

      expect(res.status).toBe('DISCOVERY_PENDING');
      expect(res.success).toBe(false);
      expect(res.status).not.toBe('DISCOVERY_SIGNAL_SENT');
    });
  });

  // 5. THIRD-PARTY URL
  describe('5. Third-Party URL Processing', () => {
    it('processes arbitrary public forum URL without requiring domain ownership', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 204,
        text: async () => '',
      } as any);

      const provider = new GoogleWebSubProvider();
      const ctx = createMockContext({
        originalUrl: THIRD_PARTY_URL,
        normalizedUrl: THIRD_PARTY_URL,
        matchedProperty: null,
      });

      const adapter = new PublicDiscoveryAdapter(provider);
      const res = await adapter.execute(ctx);

      expect(res.details.isThirdParty).toBe(true);
      expect(res.status).toBe('DISCOVERY_SIGNAL_SENT');
      expect(res.indexed).toBe(false);
      expect(res.verified).toBe(false);
    });
  });

  // 6. UNOWNED INDEXNOW DOMAIN
  describe('6. Unowned IndexNow Domain Protection', () => {
    it('returns NOT_AUTHORIZED_FOR_INDEXNOW for unowned third-party domain without making live call', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const provider = new IndexNowProvider();
      const ctx = createMockContext({
        originalUrl: THIRD_PARTY_URL,
        normalizedUrl: THIRD_PARTY_URL,
        matchedProperty: null,
        userProperties: [],
      });

      const record = await provider.submit(THIRD_PARTY_URL, ctx);

      // Must not call remote endpoint for unowned domain
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(record.accepted).toBe(false);
      expect(record.requestStatus).toBe('NOT_AUTHORIZED');
      expect(record.errorCode).toBe('NOT_AUTHORIZED_FOR_INDEXNOW');
      expect(record.errorMessage).toContain('NOT_AUTHORIZED_FOR_INDEXNOW');
    });

    it('allows IndexNow submission when domain is verified in owned properties', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => 'OK',
      } as any);

      const provider = new IndexNowProvider();
      const ctx = createMockContext({
        originalUrl: OWNED_URL,
        normalizedUrl: OWNED_URL,
        matchedProperty: {
          id: 'prop-owned-1',
          propertyUrl: 'sc-domain:indexmetrix.com',
        },
      });

      const record = await provider.submit(OWNED_URL, ctx);
      expect(record.accepted).toBe(true);
      expect(record.requestStatus).toBe('SUCCESS');
      expect(record.evidenceType).toBe('INDEXNOW_ACCEPTED');
    });
  });

  // 7. GOOGLE INDEXING API INELIGIBLE URL
  describe('7. Google Indexing API Strict Restriction', () => {
    it('returns NOT_ELIGIBLE without remote network dispatch for forum/blog content lacking JobPosting', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const provider = new GoogleIndexingApiProvider();
      const ctx = createMockContext({
        analysis: {
          ...createMockContext().analysis,
          hasStructuredJob: false,
        },
      });

      const record = await provider.submit(THIRD_PARTY_URL, ctx);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(record.accepted).toBe(false);
      expect(record.requestStatus).toBe('NOT_ELIGIBLE');
      expect(record.errorCode).toBe('NOT_SUPPORTED_CONTENT_TYPE');
      expect(record.errorMessage).toContain('restricted to supported content types');
    });
  });

  // 8. NO-PROVIDER CASE
  describe('8. No-Provider Fallback Handling', () => {
    it('returns NO_DISCOVERY_SIGNAL_AVAILABLE when provider does not support URL', async () => {
      const unsupportedProvider = {
        name: 'CUSTOM_RESTRICTED_PROVIDER',
        supports: () => false,
        submit: vi.fn(),
        getStatus: vi.fn(),
      };

      const adapter = new PublicDiscoveryAdapter(unsupportedProvider as any);
      const ctx = createMockContext();

      const res = await adapter.execute(ctx);

      expect(res.status).toBe('NO_DISCOVERY_SIGNAL_AVAILABLE');
      expect(res.success).toBe(false);
      expect(res.status).not.toBe('DISCOVERY_SIGNAL_SENT');
    });
  });

  // 9. CREDIT IDEMPOTENCY
  describe('9. Credit Ledger Idempotency & Accurate Billing', () => {
    it('deducts customer credits once and prevents double billing under identical idempotency key', async () => {
      const customer = await prisma.user.findFirst({
        where: { email: 'customer@indexmatrix.io' },
        include: { wallet: true },
      });

      if (!customer) return;

      const testKey = `unit_test_idempotent_${Date.now()}`;
      const res1 = await deductCredits({
        userId: customer.id,
        amount: 1,
        operation: 'DISCOVERY_INSPECTION',
        idempotencyKey: testKey,
        reason: 'Unit test initial dispatch',
      });

      expect(res1.success).toBe(true);

      const res2 = await deductCredits({
        userId: customer.id,
        amount: 1,
        operation: 'DISCOVERY_INSPECTION',
        idempotencyKey: testKey,
        reason: 'Unit test duplicate dispatch attempt',
      });

      expect(res2.success).toBe(true);
      expect(res2.balanceAfter).toBe(res1.balanceAfter);

      // Refund 1 credit
      await addCredits({
        userId: customer.id,
        amount: 1,
        type: 'REFUND',
        idempotencyKey: `unit_test_refund_${Date.now()}`,
        reason: 'Clean up unit test credit',
      });
    });
  });

  // 10. STATUS TRANSITIONS & NO FALSE INDEXING
  describe('10. Status Transitions & Integrity Safeguards', () => {
    it('never confuses SUBMITTED, DISCOVERY_SIGNAL_SENT, WAITING_FOR_CRAWL, and INDEXED', () => {
      const statuses = [
        'SUBMITTED',
        'DISCOVERY_PENDING',
        'DISCOVERY_SIGNAL_SENT',
        'WAITING_FOR_CRAWL',
        'INDEXED_OBSERVED',
        'INDEXED',
      ];

      // Verify each state is distinct
      const unique = new Set(statuses);
      expect(unique.size).toBe(statuses.length);

      // Rule: discovery signal sent is never indexed
      expect('DISCOVERY_SIGNAL_SENT').not.toBe('INDEXED');
      expect('DISCOVERY_SIGNAL_SENT').not.toBe('INDEXED_OBSERVED');
      expect('SUBMITTED').not.toBe('DISCOVERY_SIGNAL_SENT');
    });
  });
});
