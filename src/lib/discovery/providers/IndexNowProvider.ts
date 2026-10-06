import { DiscoveryProvider, ProviderExecutionRecord, ProviderStatusRecord } from '../provider-types';
import { DiscoveryContext } from '../types';

export class IndexNowProvider implements DiscoveryProvider {
  name = 'INDEXNOW';

  supports(url: string, ctx?: DiscoveryContext): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Evaluates whether the target domain has a legitimately verified IndexNow key.
   * Per IndexNow protocol, the key or keyLocation must reside on the target domain host.
   * For arbitrary unowned 3rd-party domains, IndexNow cannot be legitimately authorized.
   */
  isDomainKeyAuthorized(url: string, ctx?: DiscoveryContext): boolean {
    if (!ctx) return false;

    try {
      const parsed = new URL(url);
      const targetHost = parsed.hostname.toLowerCase();
      const cleanTargetHost = targetHost.replace(/^www\./, '');

      const isHostMatch = (rawPropUrl?: string | null) => {
        if (!rawPropUrl) return false;
        const propLower = rawPropUrl.toLowerCase();
        const cleanProp = propLower
          .replace(/^sc-domain:/, '')
          .replace(/^https?:\/\//, '')
          .replace(/^www\./, '')
          .replace(/\/.*$/, '');
        return cleanTargetHost === cleanProp || cleanTargetHost.endsWith('.' + cleanProp);
      };

      // Check if user has an authorized/verified property for this host
      if (ctx.matchedProperty && isHostMatch(ctx.matchedProperty.propertyUrl)) {
        return true;
      }

      // Check user properties list
      if (Array.isArray(ctx.userProperties)) {
        const match = ctx.userProperties.some((p: any) => isHostMatch(p.propertyUrl));
        if (match) return true;
      }
    } catch {
      // invalid URL
    }

    return false;
  }

  async submit(url: string, ctx?: DiscoveryContext): Promise<ProviderExecutionRecord> {
    const startedAt = new Date().toISOString();
    const urlId = ctx?.urlId || 'unknown';
    const indexNowEndpoint = 'https://api.indexnow.org/indexnow';

    let targetHost = '';
    try {
      targetHost = new URL(url).hostname;
    } catch {
      const completedAt = new Date().toISOString();
      return {
        urlId,
        provider: this.name,
        requestUrl: indexNowEndpoint,
        httpMethod: 'POST',
        startedAt,
        completedAt,
        requestStatus: 'FAILED',
        accepted: false,
        errorCode: 'INVALID_URL',
        errorMessage: 'Invalid target URL syntax for IndexNow',
        evidenceType: 'NONE',
        timestamp: completedAt,
      };
    }

    // Strict Rule 9: Check domain authorization
    const authorized = this.isDomainKeyAuthorized(url, ctx);
    if (!authorized) {
      const completedAt = new Date().toISOString();
      return {
        urlId,
        provider: this.name,
        requestUrl: indexNowEndpoint,
        httpMethod: 'POST',
        startedAt,
        completedAt,
        requestStatus: 'NOT_AUTHORIZED',
        accepted: false,
        errorCode: 'NOT_AUTHORIZED_FOR_INDEXNOW',
        errorMessage: `NOT_AUTHORIZED_FOR_INDEXNOW: Target domain "${targetHost}" key cannot be legitimately verified on unowned third-party domain.`,
        evidenceType: 'NONE',
        timestamp: completedAt,
      };
    }

    // Domain is verified: dispatch real IndexNow request
    const indexNowKey = process.env.INDEXNOW_KEY || 'indexmatrix_key';

    const controller = new AbortController();
    const timeoutMs = 5000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const payload = {
        host: targetHost,
        key: indexNowKey,
        keyLocation: `https://${targetHost}/${indexNowKey}.txt`,
        urlList: [url],
      };

      const res = await fetch(indexNowEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const completedAt = new Date().toISOString();
      const httpStatus = res.status;
      const responseText = await res.text().catch(() => '');
      const bodySummary = responseText.slice(0, 200) || `HTTP ${httpStatus}`;

      // IndexNow returns 200 OK or 202 Accepted
      const isAccepted = httpStatus === 200 || httpStatus === 202;

      return {
        urlId,
        provider: this.name,
        requestUrl: indexNowEndpoint,
        httpMethod: 'POST',
        startedAt,
        completedAt,
        requestStatus: isAccepted ? 'SUCCESS' : 'REJECTED',
        httpStatus,
        responseBodySummary: bodySummary,
        accepted: isAccepted,
        providerReference: `indexnow_${Date.now()}`,
        errorCode: isAccepted ? undefined : `HTTP_${httpStatus}`,
        errorMessage: isAccepted ? undefined : `IndexNow rejected request with status ${httpStatus}: ${bodySummary}`,
        evidenceType: isAccepted ? 'INDEXNOW_ACCEPTED' : 'NONE',
        timestamp: completedAt,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const completedAt = new Date().toISOString();
      const isTimeout = err?.name === 'AbortError' || err?.code === 'ETIMEDOUT' || err?.message?.toLowerCase().includes('timeout');

      return {
        urlId,
        provider: this.name,
        requestUrl: indexNowEndpoint,
        httpMethod: 'POST',
        startedAt,
        completedAt,
        requestStatus: isTimeout ? 'TIMEOUT' : 'FAILED',
        accepted: false,
        errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        errorMessage: isTimeout ? `IndexNow request timed out after ${timeoutMs}ms` : err?.message || 'IndexNow request failed',
        evidenceType: 'NONE',
        timestamp: completedAt,
      };
    }
  }

  async getStatus(referenceIdOrUrl: string, ctx?: DiscoveryContext): Promise<ProviderStatusRecord> {
    const isAuth = this.isDomainKeyAuthorized(referenceIdOrUrl, ctx);
    return {
      provider: this.name,
      referenceId: referenceIdOrUrl,
      status: isAuth ? 'PENDING' : 'REJECTED',
      lastCheckedAt: new Date().toISOString(),
      details: {
        authorized: isAuth,
        reason: isAuth ? 'Domain key verified' : 'NOT_AUTHORIZED_FOR_INDEXNOW',
      },
    };
  }
}
