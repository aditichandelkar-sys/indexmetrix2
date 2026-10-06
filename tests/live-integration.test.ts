import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/db';
import { inspectUrlWithGoogle } from '../src/lib/google-client';
import { findBestMatchingProperty } from '../src/lib/property-matcher';
import { validateUrlForSSRF } from '../src/lib/ssrf';
import { createBatchIndexingJob } from '../src/lib/queue';
import { deductCredits } from '../src/lib/credit-ledger';

describe('Live Integration & End-to-End Acceptance Tests', () => {
  it('verifies SSRF blocking on dangerous targets', async () => {
    const ssrfTargets = [
      'http://127.0.0.1:80',
      'http://localhost:3000',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/admin',
      'http://192.168.0.1/',
    ];

    for (const target of ssrfTargets) {
      const res = await validateUrlForSSRF(target);
      expect(res.isSafe).toBe(false);
      expect(res.reason).toBeDefined();
    }
  });

  it('verifies unauthorized property behavior without calling Google API', async () => {
    const testOwner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
    expect(testOwner).toBeDefined();

    const properties = await prisma.searchConsoleProperty.findMany({
      where: { googleAccount: { userId: testOwner!.id } },
    });

    const unauthorizedUrl = 'https://some-unauthorized-random-domain.com/article';
    const match = findBestMatchingProperty(unauthorizedUrl, properties);

    expect(match.property).toBeNull();
    expect(match.matchType).toBeNull();
  });

  it('executes live Google Search Console URL inspection for https://www.indexmetrix.com/ and persists real telemetry', async () => {
    // 1. Fetch connected Google Account
    const googleAccount = await prisma.googleAccount.findFirst({
      where: { status: 'ACTIVE' },
      include: { properties: true },
    });

    if (!googleAccount) {
      console.warn('Skipping live Google API call: No active Google account connected in DB');
      return;
    }

    // 2. Find best matching property for indexmetrix.com
    const targetUrl = 'https://www.indexmetrix.com/';
    const match = findBestMatchingProperty(targetUrl, googleAccount.properties);
    expect(match.property).not.toBeNull();
    const siteUrl = match.property!.propertyUrl;

    // 3. Call live verified Google Search Console URL Inspection API
    let inspection: any;
    try {
      inspection = await inspectUrlWithGoogle(googleAccount.id, targetUrl, siteUrl);
    } catch (err: any) {
      if (err.message.includes('ENOTFOUND') || err.message.includes('fetch failed') || err.message.includes('CONNECTION_REQUIRED') || err.message.includes('timed out')) {
        console.warn('Skipping live inspection test: Google API endpoint unreachable in test environment');
        return;
      }
      throw err;
    }

    expect(inspection).toBeDefined();
    expect(inspection.inspectionResult).toBeDefined();
    expect(inspection.inspectionResult.verdict).toBeDefined();
    expect(inspection.inspectionResult.coverageState).toBeDefined();

    const ir = inspection.inspectionResult;
    console.log('--- Real Live Google Inspection Telemetry ---');
    console.log('Target URL:', targetUrl);
    console.log('Matched Property:', siteUrl);
    console.log('Verdict:', ir.verdict);
    console.log('Coverage State:', ir.coverageState);
    console.log('Robots.txt State:', ir.robotsTxtState);
    console.log('Page Fetch State:', ir.pageFetchState);
    console.log('Crawled As:', ir.crawledAs);
    console.log('Last Crawl Time:', ir.lastCrawlTime);

    // 4. Verify telemetry fields match verified Google behavior
    expect(['PASS', 'NEUTRAL', 'FAIL']).toContain(ir.verdict);
    expect(ir.robotsTxtState).toBe('ALLOWED');

    // 5. Verify database persistence
    const owner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
    let project = await prisma.project.findFirst({ where: { domain: 'indexmetrix.com' } });

    if (!project) {
      project = await prisma.project.create({
        data: {
          userId: owner!.id,
          name: 'Index Metrix Official',
          domain: 'indexmetrix.com',
          googlePropertyId: match.property!.id,
          googlePropertyUrl: siteUrl,
        },
      });
    }

    const savedUrl = await prisma.url.upsert({
      where: {
        projectId_normalizedUrl: {
          projectId: project.id,
          normalizedUrl: targetUrl,
        },
      },
      update: {
        lastGoogleVerdict: ir.verdict,
        lastCoverageState: ir.coverageState || null,
        lastInspectedAt: new Date(),
        lastCrawl: ir.lastCrawlTime ? new Date(ir.lastCrawlTime) : undefined,
      },
      create: {
        projectId: project.id,
        originalUrl: targetUrl,
        normalizedUrl: targetUrl,
        hostname: 'www.indexmetrix.com',
        path: '/',
        status: ir.verdict === 'PASS' ? 'INDEXED' : 'NOT_INDEXED',
        lastGoogleVerdict: ir.verdict,
        lastCoverageState: ir.coverageState || null,
        lastInspectedAt: new Date(),
      },
    });

    expect(savedUrl.id).toBeDefined();

    const savedInspection = await prisma.googleInspection.create({
      data: {
        urlId: savedUrl.id,
        verdict: ir.verdict,
        coverageState: ir.coverageState || null,
        indexingState: ir.indexingState || null,
        robotsTxtState: ir.robotsTxtState || null,
        pageFetchState: ir.pageFetchState || null,
        crawledAs: ir.crawledAs || null,
        lastCrawlTime: ir.lastCrawlTime ? new Date(ir.lastCrawlTime) : null,
        rawResponse: JSON.stringify(inspection.raw),
      },
    });

    expect(savedInspection.id).toBeDefined();

    // 6. Test Batch Job Creation and Owner Unlimited Credits
    const jobResult = await createBatchIndexingJob({
      userId: owner!.id,
      projectId: project.id,
      urlIds: [savedUrl.id],
      type: 'DISCOVERY_AND_INSPECTION',
      idempotencyKey: `live_test_job_${Date.now()}`,
    });

    expect(jobResult.success).toBe(true);
    expect(jobResult.job).toBeDefined();
    expect(jobResult.job.status).toBe('QUEUED');
    expect(jobResult.job.totalUrls).toBe(1);

    // Verify Owner has unlimited credits and 0 credits were deducted
    const creditCheck = await deductCredits({
      userId: owner!.id,
      amount: 1,
      operation: 'DISCOVERY_INSPECTION',
    });
    expect(creditCheck.isUnlimited).toBe(true);
    expect(creditCheck.amountDeducted).toBe(0);
  }, 30000);
});
