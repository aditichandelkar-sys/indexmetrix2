import { DiscoveryAdapter, DiscoveryContext, DiscoveryResult } from '../types';
import { GoogleIndexingApiService } from '../../google-indexing-api';

export class GoogleIndexingApiAdapter implements DiscoveryAdapter {
  name = 'GoogleIndexingApiAdapter';

  canHandle(ctx: DiscoveryContext): boolean {
    return ctx.requestedJobType === 'OFFICIAL_INDEXING_API' || Boolean(ctx.analysis.hasStructuredJob);
  }

  getStatus(): string {
    return 'INDEXING_API_NOTIFIED';
  }

  explain(): string {
    return "Official Google Indexing API (restricted by Google strictly to JobPosting and BroadcastEvent structured data).";
  }

  async execute(ctx: DiscoveryContext): Promise<DiscoveryResult> {
    // 1. Strict Eligibility Check
    // Per Google's official documentation, the Indexing API is ONLY for JobPosting or BroadcastEvent embedded in VideoObject.
    if (!ctx.analysis.hasStructuredJob) {
      return {
        adapter: this.name,
        handled: false,
        success: false,
        status: 'NOT_ELIGIBLE',
        reason: 'Google Indexing API is restricted to supported content types.',
        signalType: 'GOOGLE_INDEXING_API',
        explanation: 'Google Indexing API is restricted to supported content types (JobPosting / BroadcastEvent in VideoObject). This URL does not contain eligible structured data.',
        details: {
          eligible: false,
          provider: 'GOOGLE_INDEXING_API',
          reason: 'Google Indexing API is restricted to supported content types.',
        },
      };
    }

    if (!ctx.matchedProperty || !ctx.matchedProperty.googleAccountId) {
      return {
        adapter: this.name,
        handled: false,
        status: 'NOT_ELIGIBLE',
        signalType: 'GOOGLE_INDEXING_API',
        explanation: 'Google Indexing API requires an authorized Google Search Console / Service Account connection for the owning domain.',
        details: { eligible: false, reason: 'Property not owned in Google account' },
      };
    }

    try {
      const res = await GoogleIndexingApiService.publishUrlNotification({
        accountId: ctx.matchedProperty.googleAccountId,
        targetUrl: ctx.normalizedUrl,
        type: 'URL_UPDATED',
        structuredDataTypes: ['JobPosting'],
      });

      if (!res.eligible) {
        return {
          adapter: this.name,
          handled: false,
          status: 'NOT_ELIGIBLE',
          signalType: 'GOOGLE_INDEXING_API',
          explanation: res.error || 'Google Indexing API is restricted to supported content types.',
          details: res,
        };
      }

      return {
        adapter: this.name,
        handled: true,
        status: 'INDEXING_API_NOTIFIED',
        signalType: 'GOOGLE_INDEXING_API_PUBLISH',
        explanation: 'Published URL update notification to Google Indexing API. (Note: HTTP 200 indicates notification delivery; it does NOT guarantee immediate indexing).',
        details: res,
      };
    } catch (err: any) {
      return {
        adapter: this.name,
        handled: true,
        status: 'FAILED',
        signalType: 'GOOGLE_INDEXING_API_PUBLISH',
        explanation: `Google Indexing API call failed: ${err.message || 'API error'}`,
        details: { error: err.message },
      };
    }
  }
}
