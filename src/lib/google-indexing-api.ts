import { safeGoogleFetch, getValidAccessToken, sanitizeGoogleError } from './google-client';
import { evaluateIndexingApiEligibility, IndexingEligibilityCheck } from './indexing-eligibility';
import { prisma } from './db';

const GOOGLE_INDEXING_API_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications:publish';

export type IndexingNotificationType = 'URL_UPDATED' | 'URL_DELETED';

export interface GoogleIndexingApiResponse {
  success: boolean;
  eligible: boolean;
  notificationAccepted: boolean;
  notificationType: IndexingNotificationType;
  targetUrl: string;
  responseTimestamp?: string;
  eligibilityCheck: IndexingEligibilityCheck;
  googleResponse?: any;
  error?: string;
}

/**
 * Service for the OFFICIAL Google Indexing API.
 *
 * CRITICAL POLICY NOTICE:
 * Per Google's official documentation, the Indexing API is strictly limited to
 * pages containing JobPosting or BroadcastEvent embedded in VideoObject.
 *
 * Submitting normal blog posts, forum pages, commercial pages, or PDFs violates
 * Google's API policies and can cause Google API quotas to be revoked.
 *
 * A successful response from this API means:
 * "Google accepted the notification for processing."
 * It DOES NOT mean: "The URL is indexed."
 */
export class GoogleIndexingApiService {
  /**
   * Publishes a URL notification to Google's official Indexing API.
   * Strictly enforces eligibility checks before calling Google.
   */
  static async publishUrlNotification(params: {
    accountId: string;
    targetUrl: string;
    type?: IndexingNotificationType;
    htmlContent?: string;
    structuredDataTypes?: string[];
    bypassEligibilityCheckForTesting?: boolean;
  }): Promise<GoogleIndexingApiResponse> {
    const {
      accountId,
      targetUrl,
      type = 'URL_UPDATED',
      htmlContent,
      structuredDataTypes,
      bypassEligibilityCheckForTesting = false,
    } = params;

    // 1. Evaluate content eligibility
    const eligibility = evaluateIndexingApiEligibility(htmlContent, structuredDataTypes);

    if (!eligibility.isEligibleForDirectIndexingApi && !bypassEligibilityCheckForTesting) {
      return {
        success: false,
        eligible: false,
        notificationAccepted: false,
        notificationType: type,
        targetUrl,
        eligibilityCheck: eligibility,
        error:
          'INELIGIBLE_CONTENT: Google Indexing API only accepts pages with JobPosting or BroadcastEvent schema. Standard URLs must use Search Console discovery and inspection workflow.',
      };
    }

    // 2. Obtain valid OAuth access token with indexing scope
    const accessToken = await getValidAccessToken(accountId);

    if (accessToken.startsWith('mock_')) {
      throw new Error(
        'CONNECTION_REQUIRED: Live Google account authorization required to publish to Google Indexing API.'
      );
    }

    // 3. Dispatch to official Google Indexing API endpoint
    const res = await safeGoogleFetch(GOOGLE_INDEXING_API_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: targetUrl,
        type,
      }),
      timeoutMs: 15000,
    });

    if (!res.ok) {
      const errText = await res.text();
      let errorMsg = errText;
      try {
        const parsed = JSON.parse(errText);
        errorMsg = parsed.error?.message || errText;
      } catch {}
      throw new Error(`Google Indexing API error (${res.status}): ${sanitizeGoogleError(errorMsg)}`);
    }

    const data = await res.json();

    return {
      success: true,
      eligible: true,
      notificationAccepted: true,
      notificationType: type,
      targetUrl,
      responseTimestamp: data.urlNotificationMetadata?.latestUpdate?.notifyTime || new Date().toISOString(),
      eligibilityCheck: eligibility,
      googleResponse: data,
    };
  }
}
