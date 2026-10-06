import { DiscoveryProvider, ProviderExecutionRecord, ProviderStatusRecord } from '../provider-types';
import { DiscoveryContext } from '../types';
import { getPublicFeedUrl } from '../../app-config';

export class GoogleWebSubProvider implements DiscoveryProvider {
  name = 'GOOGLE_WEBSUB';

  supports(url: string, ctx?: DiscoveryContext): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async submit(url: string, ctx?: DiscoveryContext): Promise<ProviderExecutionRecord> {
    const startedAt = new Date().toISOString();
    const hubUrl = process.env.WEBSUB_HUB_URL || 'https://pubsubhubbub.appspot.com/';
    const urlId = ctx?.urlId || 'unknown';

    let topicUrl: string;
    try {
      topicUrl = getPublicFeedUrl();
    } catch (configErr: any) {
      const completedAt = new Date().toISOString();
      return {
        urlId,
        provider: this.name,
        requestUrl: hubUrl,
        httpMethod: 'POST',
        startedAt,
        completedAt,
        requestStatus: 'FAILED',
        accepted: false,
        errorCode: 'INVALID_APP_BASE_URL',
        errorMessage: configErr.message || 'Invalid APP_BASE_URL configuration',
        evidenceType: 'NONE',
        timestamp: completedAt,
      };
    }

    const params = new URLSearchParams({
      'hub.mode': 'publish',
      'hub.url': topicUrl,
    });

    const controller = new AbortController();
    const timeoutMs = 5000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(hubUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const completedAt = new Date().toISOString();
      const httpStatus = res.status;
      const responseText = await res.text().catch(() => '');
      const bodySummary = responseText.slice(0, 200) || (httpStatus === 204 ? 'No Content (Feed Accepted)' : 'OK');

      const isAccepted = httpStatus === 200 || httpStatus === 204;

      return {
        urlId,
        provider: this.name,
        requestUrl: hubUrl,
        httpMethod: 'POST',
        startedAt,
        completedAt,
        requestStatus: isAccepted ? 'SUCCESS' : 'REJECTED',
        httpStatus,
        responseBodySummary: bodySummary,
        accepted: isAccepted,
        providerReference: `websub_pub_${Date.now()}`,
        errorCode: isAccepted ? undefined : `HTTP_${httpStatus}`,
        errorMessage: isAccepted ? undefined : `WebSub hub rejected feed notification with status ${httpStatus}`,
        evidenceType: isAccepted ? 'WEBSUB_FEED_ACCEPTED' : 'NONE',
        timestamp: completedAt,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const completedAt = new Date().toISOString();
      const isTimeout = err?.name === 'AbortError' || err?.code === 'ETIMEDOUT' || err?.message?.toLowerCase().includes('timeout');

      return {
        urlId,
        provider: this.name,
        requestUrl: hubUrl,
        httpMethod: 'POST',
        startedAt,
        completedAt,
        requestStatus: isTimeout ? 'TIMEOUT' : 'FAILED',
        httpStatus: undefined,
        responseBodySummary: undefined,
        accepted: false,
        errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        errorMessage: isTimeout ? `WebSub hub request timed out after ${timeoutMs}ms` : err?.message || 'Network request failed',
        evidenceType: 'NONE',
        timestamp: completedAt,
      };
    }
  }

  async getStatus(referenceIdOrUrl: string, ctx?: DiscoveryContext): Promise<ProviderStatusRecord> {
    return {
      provider: this.name,
      referenceId: referenceIdOrUrl,
      status: 'CONFIRMED',
      lastCheckedAt: new Date().toISOString(),
      details: {
        mechanism: 'Google WebSub PubSubHubbub (Real-time public feed ping)',
        note: 'Notifies feed subscribers of updated content; does not guarantee Googlebot crawl.',
      },
    };
  }
}
