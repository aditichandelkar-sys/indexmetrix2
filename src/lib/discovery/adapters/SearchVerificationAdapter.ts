import { DiscoveryAdapter, DiscoveryContext, DiscoveryResult } from '../types';
import { inspectUrlWithGoogle } from '../../google-client';
import { checkGoogleIndexStatus } from '../../serp-checker';

export interface VerificationOutcome {
  verificationMethod: 'GOOGLE_INSPECTION_API' | 'PUBLIC_SEARCH_OBSERVATION';
  verifiedAt: string;
  result: 'INDEXED_CONFIRMED' | 'INDEXED_OBSERVED' | 'NOT_OBSERVED' | 'UNKNOWN' | 'UNAVAILABLE';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  explanation: string;
  details?: any;
}

export class SearchVerificationAdapter implements DiscoveryAdapter {
  name = 'SearchVerificationAdapter';

  canHandle(ctx: DiscoveryContext): boolean {
    return true;
  }

  getStatus(): string {
    return 'VERIFIED';
  }

  explain(): string {
    return 'Verifies index status via verified Google Search Console URL Inspection (for owned properties) or public search observation (for third-party URLs).';
  }

  async execute(ctx: DiscoveryContext): Promise<DiscoveryResult> {
    const outcome = await this.verify(ctx);

    return {
      adapter: this.name,
      handled: true,
      status: 'VERIFIED',
      signalType: outcome.verificationMethod,
      explanation: outcome.explanation,
      details: outcome,
    };
  }

  async verify(ctx: DiscoveryContext): Promise<VerificationOutcome> {
    const now = new Date().toISOString();

    // 1. If property is owned in Google Search Console, use official URL Inspection API
    if (ctx.matchedProperty && ctx.matchedProperty.googleAccountId) {
      try {
        const inspection = await inspectUrlWithGoogle(
          ctx.matchedProperty.googleAccountId,
          ctx.normalizedUrl,
          ctx.matchedProperty.propertyUrl
        );

        const ir = inspection.inspectionResult;
        const coverage = (ir.coverageState || '').toLowerCase();
        const isCoverageIndexed = coverage.includes('indexed') && !coverage.includes('not indexed') && !coverage.includes('excluded');
        const isIndexed = ir.verdict === 'PASS' || isCoverageIndexed;

        return {
          verificationMethod: 'GOOGLE_INSPECTION_API',
          verifiedAt: now,
          result: isIndexed ? 'INDEXED_CONFIRMED' : 'NOT_OBSERVED',
          confidence: 'HIGH',
          explanation: `Official Google Search Console inspection verified: verdict "${ir.verdict}" (${ir.coverageState || 'No coverage state'}).`,
          details: ir,
        };
      } catch (err: any) {
        return {
          verificationMethod: 'GOOGLE_INSPECTION_API',
          verifiedAt: now,
          result: 'UNAVAILABLE',
          confidence: 'LOW',
          explanation: `Google Search Console Inspection API returned error: ${err.message || 'Unknown error'}`,
        };
      }
    }

    // 2. Third-party URL: Use public search observation without falsely claiming GSC ownership
    try {
      const serpCheck = await checkGoogleIndexStatus(ctx.normalizedUrl);

      if (serpCheck.isIndexed) {
        return {
          verificationMethod: 'PUBLIC_SEARCH_OBSERVATION',
          verifiedAt: now,
          result: 'INDEXED_OBSERVED',
          confidence: 'MEDIUM',
          explanation: 'Public search observation: URL appears in Google public search results.',
          details: serpCheck,
        };
      }

      return {
        verificationMethod: 'PUBLIC_SEARCH_OBSERVATION',
        verifiedAt: now,
        result: 'NOT_OBSERVED',
        confidence: 'MEDIUM',
        explanation: 'Public search observation: URL not observed in Google search index for this target query.',
        details: serpCheck,
      };
    } catch (err: any) {
      return {
        verificationMethod: 'PUBLIC_SEARCH_OBSERVATION',
        verifiedAt: now,
        result: 'UNKNOWN',
        confidence: 'LOW',
        explanation: `Public search observation encountered a temporary network delay: ${err.message}`,
      };
    }
  }
}
