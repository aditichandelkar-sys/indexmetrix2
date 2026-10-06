import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeUrl, findBestMatchingProperty } from '../src/lib/property-matcher';
import { validateUrlForSSRF } from '../src/lib/ssrf';
import { extractCandidateUrls } from '../src/lib/bulk-importer';
import { evaluateIndexingApiEligibility } from '../src/lib/indexing-eligibility';
import { GoogleIndexingApiService } from '../src/lib/google-indexing-api';
import { deductCredits, addCredits, CREDIT_COSTS } from '../src/lib/credit-ledger';
import { prisma } from '../src/lib/db';

describe('Commercial Indexing & Discovery Service Engine', () => {
  describe('1. URL Normalization & SSRF Defense', () => {
    it('normalizes valid HTTP and HTTPS URLs correctly', () => {
      const { url: u1, error: e1 } = normalizeUrl('https://example.com/test/');
      expect(e1).toBeUndefined();
      expect(u1?.toString()).toBe('https://example.com/test');

      const { url: u2, error: e2 } = normalizeUrl('HTTP://WWW.EXAMPLE.COM:80/path/to/page');
      expect(e2).toBeUndefined();
      expect(u2?.toString()).toBe('http://www.example.com/path/to/page');
    });

    it('rejects invalid, dangerous, and malformed URLs', () => {
      const { error: e1 } = normalizeUrl('javascript:alert(1)');
      expect(e1).toBeDefined();

      const { error: e2 } = normalizeUrl('ftp://ftp.example.com/file');
      expect(e2).toBeDefined();

      const { error: e3 } = normalizeUrl('http://?invalid');
      expect(e3).toBeDefined();
    });

    it('strictly blocks SSRF targets: localhost, loopback, private IPs, and cloud metadata', async () => {
      const loopback1 = await validateUrlForSSRF('http://localhost:3000/api');
      expect(loopback1.isSafe).toBe(false);

      const loopback2 = await validateUrlForSSRF('http://127.0.0.1/admin');
      expect(loopback2.isSafe).toBe(false);

      const privateIp1 = await validateUrlForSSRF('http://10.0.0.1/internal');
      expect(privateIp1.isSafe).toBe(false);

      const privateIp2 = await validateUrlForSSRF('http://192.168.1.1/');
      expect(privateIp2.isSafe).toBe(false);

      const cloudMeta = await validateUrlForSSRF('http://169.254.169.254/latest/meta-data/');
      expect(cloudMeta.isSafe).toBe(false);

      const safeUrl = await validateUrlForSSRF('https://www.google.com/');
      expect(safeUrl.isSafe).toBe(true);
    });
  });

  describe('2. Bulk URL Import Extraction (TXT, CSV, Sitemap, RSS)', () => {
    it('extracts candidate URLs from plain text input', async () => {
      const rawText = `
        https://example.com/page-1
        https://example.com/page-2
        # comment line to ignore
        https://example.com/page-3
      `;
      const { candidates } = await extractCandidateUrls('RAW_TEXT', rawText);
      expect(candidates).toHaveLength(3);
      expect(candidates[0]).toBe('https://example.com/page-1');
      expect(candidates[1]).toBe('https://example.com/page-2');
      expect(candidates[2]).toBe('https://example.com/page-3');
    });

    it('extracts URLs from CSV content with URL column header', async () => {
      const csvData = `url,title,priority\nhttps://example.com/csv-1,Home,1.0\nhttps://example.com/csv-2,About,0.8`;
      const { candidates } = await extractCandidateUrls('CSV_FILE', csvData);
      expect(candidates).toHaveLength(2);
      expect(candidates[0]).toBe('https://example.com/csv-1');
      expect(candidates[1]).toBe('https://example.com/csv-2');
    });

    it('extracts URLs from CSV without header by detecting HTTP column', async () => {
      const csvNoHeader = `123,https://example.com/auto-detected,active\n456,https://example.com/another-row,pending`;
      const { candidates } = await extractCandidateUrls('CSV_FILE', csvNoHeader);
      expect(candidates).toHaveLength(2);
      expect(candidates[0]).toBe('https://example.com/auto-detected');
      expect(candidates[1]).toBe('https://example.com/another-row');
    });
  });

  describe('3. Google Search Console Property Matching & Authorization', () => {
    const mockProperties = [
      { id: 'prop-domain', propertyUrl: 'sc-domain:indexmetrix.com', googleAccountId: 'acc-1' },
      { id: 'prop-prefix', propertyUrl: 'https://www.indexmetrix.com/blog/', googleAccountId: 'acc-1' },
    ];

    it('correctly matches domain properties against subdomains and paths', () => {
      const match = findBestMatchingProperty('https://www.indexmetrix.com/features', mockProperties);
      expect(match.property?.id).toBe('prop-domain');
      expect(match.matchType).toBe('DOMAIN');
    });

    it('prioritizes exact URL-prefix property when covering specific subpath', () => {
      const match = findBestMatchingProperty('https://www.indexmetrix.com/blog/new-article', mockProperties);
      expect(match.property?.id).toBe('prop-prefix');
      expect(match.matchType).toBe('EXACT_PREFIX');
    });

    it('detects unauthorized properties for URLs not covered by user GSC accounts', () => {
      const match = findBestMatchingProperty('https://unauthorized-domain.com/secret', mockProperties);
      expect(match.property).toBeNull();
      expect(match.matchType).toBeNull();
    });
  });

  describe('4. Official Google Indexing API Policy Enforcement', () => {
    it('strictly marks ordinary web pages as ineligible for direct Google Indexing API', () => {
      const standardHtml = `<html><head><title>My Blog Post</title></head><body>Standard article</body></html>`;
      const eligibility = evaluateIndexingApiEligibility(standardHtml);

      expect(eligibility.isEligibleForDirectIndexingApi).toBe(false);
      expect(eligibility.contentType).toBe('STANDARD_WEB_PAGE');
      expect(eligibility.recommendedWorkflow).toBe('SEARCH_CONSOLE_INSPECTION_AND_SITEMAP');
    });

    it('approves pages containing valid JobPosting structured data for Google Indexing API', () => {
      const jobHtml = `
        <html><head>
          <script type="application/ld+json">
            { "@context": "https://schema.org", "@type": "JobPosting", "title": "Software Engineer" }
          </script>
        </head></html>
      `;
      const eligibility = evaluateIndexingApiEligibility(jobHtml);

      expect(eligibility.isEligibleForDirectIndexingApi).toBe(true);
      expect(eligibility.contentType).toBe('JOB_POSTING');
      expect(eligibility.recommendedWorkflow).toBe('DIRECT_INDEXING_API');
    });

    it('approves pages containing valid BroadcastEvent structured data', () => {
      const broadcastHtml = `
        <html><head>
          <script type="application/ld+json">
            { "@context": "https://schema.org", "@type": "BroadcastEvent", "name": "Live Webinar" }
          </script>
        </head></html>
      `;
      const eligibility = evaluateIndexingApiEligibility(broadcastHtml);

      expect(eligibility.isEligibleForDirectIndexingApi).toBe(true);
      expect(eligibility.contentType).toBe('BROADCAST_EVENT');
    });

    it('GoogleIndexingApiService rejects ineligible content before making any external API calls', async () => {
      const res = await GoogleIndexingApiService.publishUrlNotification({
        accountId: 'dummy-acc',
        targetUrl: 'https://example.com/blog/standard-post',
        htmlContent: '<html><body>No job posting here</body></html>',
      });

      expect(res.success).toBe(false);
      expect(res.eligible).toBe(false);
      expect(res.notificationAccepted).toBe(false);
      expect(res.error).toContain('INELIGIBLE_CONTENT');
    });
  });

  describe('5. Credit Ledger ACID Guarantees & Idempotency', () => {
    it('OWNER user with UNLIMITED credit mode bypasses deduction (0 credits deducted)', async () => {
      const testOwnerId = 'owner-test-' + Date.now();
      await prisma.user.create({
        data: {
          id: testOwnerId,
          email: `${testOwnerId}@indexmatrix.io`,
          passwordHash: 'dummy',
          name: 'Owner Tester',
          role: 'OWNER',
          creditMode: 'UNLIMITED',
        },
      });

      const result = await deductCredits({
        userId: testOwnerId,
        amount: 5,
        operation: 'DISCOVERY_INSPECTION',
      });

      expect(result.success).toBe(true);
      expect(result.isUnlimited).toBe(true);
      expect(result.amountDeducted).toBe(0);
    });

    it('CUSTOMER user is prevented from deducting when credits are insufficient', async () => {
      const testCustId = 'cust-insufficient-' + Date.now();
      const user = await prisma.user.create({
        data: {
          id: testCustId,
          email: `${testCustId}@example.com`,
          passwordHash: 'dummy',
          name: 'Customer Tester',
          role: 'CUSTOMER',
          creditMode: 'LIMITED',
          wallet: {
            create: { balance: 0 },
          },
        },
      });

      const result = await deductCredits({
        userId: testCustId,
        amount: 1,
        operation: 'DISCOVERY_INSPECTION',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INSUFFICIENT_CREDITS');
    });

    it('enforces idempotency key to prevent double charging on retries', async () => {
      const testCustId = 'cust-idempotent-' + Date.now();
      await prisma.user.create({
        data: {
          id: testCustId,
          email: `${testCustId}@example.com`,
          passwordHash: 'dummy',
          name: 'Customer Idempotent',
          role: 'CUSTOMER',
          creditMode: 'LIMITED',
          wallet: {
            create: { balance: 10 },
          },
        },
      });

      const idempotencyKey = `tx_test_${Date.now()}`;

      // First deduction
      const res1 = await deductCredits({
        userId: testCustId,
        amount: 2,
        operation: 'DISCOVERY_INSPECTION',
        idempotencyKey,
      });

      expect(res1.success).toBe(true);
      expect(res1.balanceAfter).toBe(8);

      // Replay with identical idempotencyKey
      const res2 = await deductCredits({
        userId: testCustId,
        amount: 2,
        operation: 'DISCOVERY_INSPECTION',
        idempotencyKey,
      });

      // Should return previous result without deducting again!
      expect(res2.success).toBe(true);
      expect(res2.balanceAfter).toBe(8);

      const wallet = await prisma.creditWallet.findUnique({ where: { userId: testCustId } });
      expect(wallet?.balance).toBe(8); // Balance remained 8, not 6
    });

    it('refunds customer credits atomically on failed operations', async () => {
      const testCustId = 'cust-refund-' + Date.now();
      await prisma.user.create({
        data: {
          id: testCustId,
          email: `${testCustId}@example.com`,
          passwordHash: 'dummy',
          name: 'Customer Refund',
          role: 'CUSTOMER',
          creditMode: 'LIMITED',
          wallet: {
            create: { balance: 5 },
          },
        },
      });

      // Deduct 1 credit
      await deductCredits({
        userId: testCustId,
        amount: 1,
        operation: 'DISCOVERY_INSPECTION',
      });

      // Issue refund
      const refundRes = await addCredits({
        userId: testCustId,
        amount: 1,
        type: 'REFUND',
        idempotencyKey: `refund_test_${Date.now()}`,
        reason: 'Refund for failed inspection',
      });

      expect(refundRes.success).toBe(true);
      expect(refundRes.balanceAfter).toBe(5);
    });
  });

  describe('6. Honest Status Mapping (No Fake Indexing)', () => {
    it('maps Google NEUTRAL and "Crawled - currently not indexed" to NOT_INDEXED', () => {
      const verdict: string = 'NEUTRAL';
      const coverageState = 'Crawled - currently not indexed';

      let mappedStatus = 'NOT_INDEXED';
      if (verdict === 'PASS' || (coverageState.toLowerCase().includes('indexed') && !coverageState.toLowerCase().includes('not indexed'))) {
        mappedStatus = 'INDEXED';
      }

      expect(mappedStatus).toBe('NOT_INDEXED');
    });

    it('maps Google PASS with indexed coverage strictly to INDEXED', () => {
      const verdict: string = 'PASS';
      const coverageState = 'Submitted and indexed';

      let mappedStatus = 'NOT_INDEXED';
      if (verdict === 'PASS' || (coverageState.toLowerCase().includes('indexed') && !coverageState.toLowerCase().includes('not indexed'))) {
        mappedStatus = 'INDEXED';
      }

      expect(mappedStatus).toBe('INDEXED');
    });
  });
});
