import { DiscoveryContext, DiscoveryEngineResult, DiscoveryResult } from './types';
import { GoogleSearchConsoleAdapter } from './adapters/GoogleSearchConsoleAdapter';
import { GoogleIndexingApiAdapter } from './adapters/GoogleIndexingApiAdapter';
import { SitemapAdapter } from './adapters/SitemapAdapter';
import { PublicDiscoveryAdapter } from './adapters/PublicDiscoveryAdapter';
import { SearchVerificationAdapter } from './adapters/SearchVerificationAdapter';
import { prisma } from '../db';

export function calculateReadinessScore(ctx: DiscoveryContext): { score: number; level: 'HIGH' | 'MEDIUM' | 'LOW' | 'BLOCKED' } {
  const { analysis } = ctx;

  if (!analysis.robotsAllowed || analysis.noindex) {
    return { score: 0, level: 'BLOCKED' };
  }

  if (analysis.httpStatus !== 200) {
    return { score: 20, level: 'LOW' };
  }

  let score = 50; // Base score for 200 OK + robots allowed + no noindex

  if (analysis.canonicalMatches) score += 15;
  if (analysis.title && analysis.title.length > 5) score += 10;
  if (analysis.hasSitemap) score += 10;
  if (analysis.wordCount > 150) score += 10;
  if (analysis.hasStructuredJob) score += 5;

  score = Math.min(100, score);

  let level: 'HIGH' | 'MEDIUM' | 'LOW' | 'BLOCKED' = 'MEDIUM';
  if (score >= 80) level = 'HIGH';
  else if (score < 50) level = 'LOW';

  return { score, level };
}

export async function executeDiscoveryPipeline(ctx: DiscoveryContext): Promise<DiscoveryEngineResult> {
  // 1. Verify URL record exists if urlId is provided
  const existingUrl = ctx.urlId
    ? await prisma.url.findUnique({ where: { id: ctx.urlId } })
    : null;

  const isOwned = Boolean(ctx.matchedProperty && ctx.matchedProperty.googleAccountId);
  const { score: readinessScore, level: readinessLevel } = calculateReadinessScore(ctx);

  const signals: DiscoveryResult[] = [];
  const explanations: string[] = [];

  const publicAdapter = new PublicDiscoveryAdapter();
  const sitemapAdapter = new SitemapAdapter();
  const gscAdapter = new GoogleSearchConsoleAdapter();
  const indexingApiAdapter = new GoogleIndexingApiAdapter();

  let publicResult: DiscoveryResult | null = null;
  // 2. Run Public Discovery signal
  if (publicAdapter.canHandle(ctx)) {
    publicResult = await publicAdapter.execute(ctx);
    signals.push(publicResult);
    explanations.push(publicResult.explanation);
  }

  // 3. Check sitemaps
  if (sitemapAdapter.canHandle(ctx)) {
    const smRes = await sitemapAdapter.execute(ctx);
    signals.push(smRes);
    explanations.push(smRes.explanation);
  }

  // 4. Official Google Indexing API (only if requested or eligible)
  if (indexingApiAdapter.canHandle(ctx)) {
    const idxRes = await indexingApiAdapter.execute(ctx);
    signals.push(idxRes);
    explanations.push(idxRes.explanation);
  }

  // 5. Google Search Console URL Inspection (only for owned properties)
  let gscResult: DiscoveryResult | null = null;
  if (isOwned && gscAdapter.canHandle(ctx) && ctx.requestedJobType !== 'OFFICIAL_INDEXING_API') {
    gscResult = await gscAdapter.execute(ctx);
    signals.push(gscResult);
    explanations.push(gscResult.explanation);
  } else if (!isOwned) {
    explanations.push(
      'Google Search Console verification is unavailable for this third-party URL. INDEX MATRIX can continue public discovery analysis, but Google-owned-property inspection/request features are unavailable.'
    );
  }

  // 6. Determine overall URL status & discoveryStatus
  let overallStatus: any = 'DISCOVERY_PENDING';
  let discoveryStatus = 'WAITING_FOR_CRAWL';

  if (!ctx.analysis.robotsAllowed) {
    overallStatus = 'BLOCKED';
    discoveryStatus = 'BLOCKED_ROBOTS';
  } else if (ctx.analysis.noindex) {
    overallStatus = 'BLOCKED';
    discoveryStatus = 'BLOCKED_NOINDEX';
  } else if (ctx.analysis.httpStatus >= 400) {
    overallStatus = 'ERROR';
    discoveryStatus = `HTTP_${ctx.analysis.httpStatus}`;
  } else if (gscResult && gscResult.status === 'GSC_INSPECTED') {
    const verdict = gscResult.details?.verdict;
    const coverage = (gscResult.details?.coverageState || '').toLowerCase();
    const isCoverageIndexed = coverage.includes('indexed') && !coverage.includes('not indexed') && !coverage.includes('excluded');
    if (verdict === 'PASS' || isCoverageIndexed) {
      overallStatus = 'INDEXED';
      discoveryStatus = 'INDEXED_CONFIRMED';
    } else {
      overallStatus = 'NOT_INDEXED';
      discoveryStatus = 'GSC_INSPECTED_NOT_INDEXED';
    }
  } else {
    // Crawlable third-party or uninspected URL
    overallStatus = 'DISCOVERY_PENDING';
    if (publicResult) {
      if (publicResult.status === 'DISCOVERY_SIGNAL_SENT') {
        discoveryStatus = 'DISCOVERY_SIGNAL_SENT';
      } else if (publicResult.status === 'NO_DISCOVERY_SIGNAL_AVAILABLE') {
        discoveryStatus = 'NO_DISCOVERY_SIGNAL_AVAILABLE';
      } else {
        discoveryStatus = isOwned ? 'WAITING_FOR_CRAWL' : 'DISCOVERY_PENDING';
      }
    } else {
      discoveryStatus = isOwned ? 'WAITING_FOR_CRAWL' : 'DISCOVERY_PENDING';
    }
  }

  // 7. Update database record and write status history if record exists
  if (existingUrl) {
    await prisma.url.update({
      where: { id: existingUrl.id },
      data: {
        status: overallStatus,
        discoveryStatus,
        httpStatus: ctx.analysis.httpStatus,
        lastAnalyzedAt: new Date(),
        matchedPropertyId: ctx.matchedProperty?.id || null,
        ...(overallStatus === 'INDEXED' ? { lastIndexedAt: new Date() } : {}),
      },
    });

    await prisma.urlStatusHistory.create({
      data: {
        urlId: existingUrl.id,
        newStatus: overallStatus,
        source: isOwned ? 'GOOGLE_INSPECTION' : 'DISCOVERY_ENGINE',
        reason: explanations[0] || 'Discovery pipeline executed',
      },
    });
  }

  return {
    urlId: ctx.urlId,
    normalizedUrl: ctx.normalizedUrl,
    isOwnedProperty: isOwned,
    matchedPropertyUrl: ctx.matchedProperty?.propertyUrl || null,
    readinessScore,
    readinessLevel,
    overallStatus,
    discoveryStatus,
    signals,
    explanations,
  };
}
