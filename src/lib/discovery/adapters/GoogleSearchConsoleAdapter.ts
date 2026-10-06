import { DiscoveryAdapter, DiscoveryContext, DiscoveryResult } from '../types';
import { inspectUrlWithGoogle } from '../../google-client';
import { prisma } from '../../db';

export class GoogleSearchConsoleAdapter implements DiscoveryAdapter {
  name = 'GoogleSearchConsoleAdapter';

  canHandle(ctx: DiscoveryContext): boolean {
    return Boolean(ctx.matchedProperty && ctx.matchedProperty.googleAccountId);
  }

  getStatus(): string {
    return 'GSC_INSPECTED';
  }

  explain(): string {
    return 'Queries official Google Search Console URL Inspection API for real index telemetry under verified owned properties.';
  }

  async execute(ctx: DiscoveryContext): Promise<DiscoveryResult> {
    if (!ctx.matchedProperty) {
      return {
        adapter: this.name,
        handled: false,
        status: 'SKIPPED',
        signalType: 'NONE',
        explanation:
          'Google Search Console verification is unavailable for this third-party URL. INDEX MATRIX can continue public discovery analysis, but Google-owned-property inspection/request features are unavailable.',
      };
    }

    try {
      const inspection = await inspectUrlWithGoogle(
        ctx.matchedProperty.googleAccountId,
        ctx.normalizedUrl,
        ctx.matchedProperty.propertyUrl
      );

      const ir = inspection.inspectionResult;

      // Persist GoogleInspection record
      await prisma.googleInspection.create({
        data: {
          urlId: ctx.urlId,
          verdict: ir.verdict || 'NEUTRAL',
          coverageState: ir.coverageState || null,
          indexingState: ir.indexingState || null,
          robotsTxtState: ir.robotsTxtState || null,
          pageFetchState: ir.pageFetchState || null,
          googleCanonical: ir.googleCanonical || null,
          userCanonical: ir.userCanonical || null,
          crawledAs: ir.crawledAs || null,
          lastCrawlTime: ir.lastCrawlTime ? new Date(ir.lastCrawlTime) : null,
          rawResponse: JSON.stringify(inspection.raw),
        },
      });

      return {
        adapter: this.name,
        handled: true,
        status: 'GSC_INSPECTED',
        signalType: 'GSC_URL_INSPECTION',
        explanation: `Real Google Inspection returned verdict: ${ir.verdict} (${ir.coverageState || 'No coverage state'})`,
        details: {
          verdict: ir.verdict,
          coverageState: ir.coverageState,
          lastCrawlTime: ir.lastCrawlTime,
          robotsTxtState: ir.robotsTxtState,
          pageFetchState: ir.pageFetchState,
        },
      };
    } catch (err: any) {
      return {
        adapter: this.name,
        handled: true,
        status: 'FAILED',
        signalType: 'GSC_URL_INSPECTION',
        explanation: `Google Search Console Inspection failed: ${err.message || 'API error'}`,
        details: { error: err.message },
      };
    }
  }
}
