import { DiscoveryProvider, ProviderExecutionRecord, ProviderStatusRecord } from '../provider-types';
import { DiscoveryContext } from '../types';
import { GoogleIndexingApiService } from '../../google-indexing-api';

export class GoogleIndexingApiProvider implements DiscoveryProvider {
  name = 'GOOGLE_INDEXING_API';

  supports(url: string, ctx?: DiscoveryContext): boolean {
    if (!ctx) return false;
    // Strictly restricted to JobPosting / BroadcastEvent per Google's official documentation
    return Boolean(ctx.analysis?.hasStructuredJob || ctx.requestedJobType === 'OFFICIAL_INDEXING_API');
  }

  async submit(url: string, ctx?: DiscoveryContext): Promise<ProviderExecutionRecord> {
    const startedAt = new Date().toISOString();
    const urlId = ctx?.urlId || 'unknown';
    const endpoint = 'https://indexing.googleapis.com/v3/urlNotifications:publish';

    // 1. Strict Eligibility Check
    if (!ctx?.analysis?.hasStructuredJob) {
      const completedAt = new Date().toISOString();
      return {
        urlId,
        provider: this.name,
        requestUrl: endpoint,
        httpMethod: 'POST',
        startedAt,
        completedAt,
        requestStatus: 'NOT_ELIGIBLE',
        accepted: false,
        errorCode: 'NOT_SUPPORTED_CONTENT_TYPE',
        errorMessage: 'Google Indexing API is restricted to supported content types (JobPosting / BroadcastEvent). Standard web pages and forums are not eligible.',
        evidenceType: 'NONE',
        timestamp: completedAt,
      };
    }

    // 2. Ownership / Account Connection Check
    if (!ctx?.matchedProperty?.googleAccountId) {
      const completedAt = new Date().toISOString();
      return {
        urlId,
        provider: this.name,
        requestUrl: endpoint,
        httpMethod: 'POST',
        startedAt,
        completedAt,
        requestStatus: 'NOT_AUTHORIZED',
        accepted: false,
        errorCode: 'GOOGLE_ACCOUNT_REQUIRED',
        errorMessage: 'Google Indexing API requires an authorized Google account connected for the verified property.',
        evidenceType: 'NONE',
        timestamp: completedAt,
      };
    }

    // 3. Dispatch to official Google Indexing API
    try {
      const res = await GoogleIndexingApiService.publishUrlNotification({
        accountId: ctx.matchedProperty.googleAccountId,
        targetUrl: url,
        type: 'URL_UPDATED',
        structuredDataTypes: ['JobPosting'],
      });

      const completedAt = new Date().toISOString();

      if (!res.eligible) {
        return {
          urlId,
          provider: this.name,
          requestUrl: endpoint,
          httpMethod: 'POST',
          startedAt,
          completedAt,
          requestStatus: 'NOT_ELIGIBLE',
          accepted: false,
          errorCode: 'NOT_SUPPORTED_CONTENT_TYPE',
          errorMessage: res.error || 'Content ineligible for Google Indexing API',
          evidenceType: 'NONE',
          timestamp: completedAt,
        };
      }

      const isAccepted = Boolean(res.notificationAccepted && res.success);
      const notifyTime = res.googleResponse?.urlNotificationMetadata?.latestUpdate?.notifyTime || res.responseTimestamp;

      return {
        urlId,
        provider: this.name,
        requestUrl: endpoint,
        httpMethod: 'POST',
        startedAt,
        completedAt,
        requestStatus: isAccepted ? 'SUCCESS' : 'FAILED',
        httpStatus: isAccepted ? 200 : 400,
        responseBodySummary: notifyTime ? `NotifyTime: ${notifyTime}` : (res.error || 'OK'),
        accepted: isAccepted,
        providerReference: notifyTime || `google_idx_${Date.now()}`,
        errorCode: isAccepted ? undefined : 'GOOGLE_INDEXING_API_ERROR',
        errorMessage: isAccepted ? undefined : res.error || 'Google Indexing API error',
        evidenceType: isAccepted ? 'INDEXING_API_ACCEPTED' : 'NONE',
        timestamp: completedAt,
      };
    } catch (err: any) {
      const completedAt = new Date().toISOString();
      return {
        urlId,
        provider: this.name,
        requestUrl: endpoint,
        httpMethod: 'POST',
        startedAt,
        completedAt,
        requestStatus: 'FAILED',
        accepted: false,
        errorCode: 'API_DISPATCH_ERROR',
        errorMessage: err?.message || 'Google Indexing API execution failed',
        evidenceType: 'NONE',
        timestamp: completedAt,
      };
    }
  }

  async getStatus(referenceIdOrUrl: string, ctx?: DiscoveryContext): Promise<ProviderStatusRecord> {
    const isEligible = Boolean(ctx?.analysis?.hasStructuredJob);
    return {
      provider: this.name,
      referenceId: referenceIdOrUrl,
      status: isEligible ? 'PENDING' : 'REJECTED',
      lastCheckedAt: new Date().toISOString(),
      details: {
        eligible: isEligible,
        policy: 'Google Indexing API restricted to JobPosting and BroadcastEvent in VideoObject.',
      },
    };
  }
}
