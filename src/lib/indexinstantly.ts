/**
 * IndexInstantly API Integration Service
 * 
 * Provider documentation:
 * - Base URL: https://www.indexinstantly.com/wp-json/indexinstantly/v1
 * - Submission: POST /index
 * - Batch Status: GET /batch/{batch_id}
 * - Authentication: Authorization: Bearer ${INDEXINSTANTLY_API_KEY}
 * 
 * Strictly server-side: Never hardcode or expose API keys.
 */

export interface IndexInstantlySubmitResponse {
  batch_id: string;
  accepted: number;
  blocked?: number;
  duplicates?: number;
  duplicate_urls?: string[];
  status: string;
  remaining_credits?: number;
  raw?: any;
}

export interface IndexInstantlyUrlItem {
  url: string;
  status?: string;
  indexed?: boolean;
  error?: string;
}

export interface IndexInstantlyBatchStatusResponse {
  batch_id: string;
  status: string; // "queued" | "processing" | "indexed" | "failed" | "duplicate" | "blocked" | "success"
  normalizedStatus: 'SUBMITTED' | 'PROCESSING' | 'INDEXED' | 'FAILED' | 'BLOCKED';
  accepted?: number;
  completed?: number;
  urls?: IndexInstantlyUrlItem[];
  raw?: any;
}

export interface IndexInstantlyError {
  code: string;
  message: string;
  statusCode?: number;
  retryAfterSeconds?: number;
}

export interface IndexInstantlyResult<T> {
  success: boolean;
  data?: T;
  error?: IndexInstantlyError;
}

const INDEXINSTANTLY_API_BASE_URL =
  process.env.INDEXINSTANTLY_API_BASE_URL?.trim() ||
  'https://www.indexinstantly.com/wp-json/indexinstantly/v1';

/**
 * Retrieves the API key safely from the server environment.
 * Never exposed to frontend or client bundle.
 */
export function getIndexInstantlyApiKey(): string | null {
  const key = process.env.INDEXINSTANTLY_API_KEY?.trim();
  return key || null;
}

/**
 * Normalizes provider status strings into standard INDEX METRIX UrlStatus.
 */
export function normalizeProviderStatus(
  providerStatus?: string | null
): 'SUBMITTED' | 'PROCESSING' | 'INDEXED' | 'FAILED' | 'BLOCKED' {
  if (!providerStatus) return 'SUBMITTED';

  const s = providerStatus.toLowerCase().trim();

  if (s === 'indexed' || s === 'success' || s === 'completed') {
    return 'INDEXED';
  }

  if (s === 'processing' || s === 'in_progress') {
    return 'PROCESSING';
  }

  if (s === 'failed' || s === 'error' || s === 'refused') {
    return 'FAILED';
  }

  if (s === 'blocked') {
    return 'BLOCKED';
  }

  // "queued", "pending", "duplicate", or unknown
  return 'SUBMITTED';
}

/**
 * Submits a batch of third-party URLs to the IndexInstantly indexing API.
 * 
 * @param urls Array of absolute target URLs (maximum 200 per request)
 * @returns IndexInstantlyResult containing batch_id and submission counters
 */
export async function submitUrls(
  urls: string[]
): Promise<IndexInstantlyResult<IndexInstantlySubmitResponse>> {
  if (!Array.isArray(urls) || urls.length === 0) {
    return {
      success: false,
      error: {
        code: 'EMPTY_URLS',
        message: 'At least one URL is required for submission.',
        statusCode: 400,
      },
    };
  }

  if (urls.length > 200) {
    return {
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Maximum batch size is 200 URLs per request.',
        statusCode: 422,
      },
    };
  }

  const apiKey = getIndexInstantlyApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: {
        code: 'MISSING_API_KEY',
        message:
          'IndexInstantly API key is not configured. Please add INDEXINSTANTLY_API_KEY to your environment variables.',
        statusCode: 503,
      },
    };
  }

  const endpoint = `${INDEXINSTANTLY_API_BASE_URL}/index`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ urls }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle HTTP error statuses
    if (!res.ok) {
      let errorBody: any = null;
      try {
        errorBody = await res.json();
      } catch {
        // Fallback to text if body is not JSON
      }

      if (res.status === 401) {
        return {
          success: false,
          error: {
            code: 'INVALID_API_KEY',
            message: 'IndexInstantly authentication failed. Please check INDEXINSTANTLY_API_KEY.',
            statusCode: 401,
          },
        };
      }

      if (res.status === 402) {
        return {
          success: false,
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message:
              errorBody?.message ||
              'Insufficient IndexInstantly credits. Please refill your provider account balance.',
            statusCode: 402,
          },
        };
      }

      if (res.status === 422) {
        return {
          success: false,
          error: {
            code: 'UNPROCESSABLE_ENTITY',
            message:
              errorBody?.message ||
              'IndexInstantly rejected the URL payload. Please verify URL formats.',
            statusCode: 422,
          },
        };
      }

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '60', 10);
        return {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message:
              errorBody?.message ||
              `IndexInstantly rate limit reached. Please retry after ${retryAfter} seconds.`,
            statusCode: 429,
            retryAfterSeconds: retryAfter,
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'PROVIDER_ERROR',
          message:
            errorBody?.message ||
            `IndexInstantly returned HTTP ${res.status}: ${res.statusText}`,
          statusCode: res.status,
        },
      };
    }

    const data = await res.json();

    if (!data || typeof data !== 'object') {
      return {
        success: false,
        error: {
          code: 'INVALID_PROVIDER_RESPONSE',
          message: 'Received invalid JSON response from IndexInstantly.',
          statusCode: 502,
        },
      };
    }

    const batchId = data.batch_id || data.batchId || data.id;
    if (!batchId) {
      return {
        success: false,
        error: {
          code: 'MISSING_BATCH_ID',
          message: 'IndexInstantly response did not include a valid batch ID.',
          statusCode: 502,
        },
      };
    }

    return {
      success: true,
      data: {
        batch_id: String(batchId),
        accepted: typeof data.accepted === 'number' ? data.accepted : urls.length,
        blocked: data.blocked,
        duplicates: data.duplicates,
        duplicate_urls: data.duplicate_urls,
        status: data.status || 'queued',
        remaining_credits: data.remaining_credits,
        raw: data,
      },
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: {
          code: 'REQUEST_TIMEOUT',
          message: 'IndexInstantly API request timed out after 20 seconds.',
          statusCode: 504,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: err.message || 'Failed to reach IndexInstantly API service.',
        statusCode: 503,
      },
    };
  }
}

/**
 * Retrieves the processing status of a previously submitted batch.
 * 
 * @param batchId The unique batch ID returned during submission
 * @returns IndexInstantlyResult with normalized status and provider details
 */
export async function getBatchStatus(
  batchId: string
): Promise<IndexInstantlyResult<IndexInstantlyBatchStatusResponse>> {
  if (!batchId || !batchId.trim()) {
    return {
      success: false,
      error: {
        code: 'INVALID_BATCH_ID',
        message: 'Batch ID is required to query IndexInstantly status.',
        statusCode: 400,
      },
    };
  }

  const apiKey = getIndexInstantlyApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: {
        code: 'MISSING_API_KEY',
        message:
          'IndexInstantly API key is not configured. Please add INDEXINSTANTLY_API_KEY to your environment variables.',
        statusCode: 503,
      },
    };
  }

  const endpoint = `${INDEXINSTANTLY_API_BASE_URL}/batch/${encodeURIComponent(batchId.trim())}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      let errorBody: any = null;
      try {
        errorBody = await res.json();
      } catch {
        // Fallback
      }

      if (res.status === 401) {
        return {
          success: false,
          error: {
            code: 'INVALID_API_KEY',
            message: 'IndexInstantly authentication failed. Please check INDEXINSTANTLY_API_KEY.',
            statusCode: 401,
          },
        };
      }

      if (res.status === 404) {
        return {
          success: false,
          error: {
            code: 'BATCH_NOT_FOUND',
            message: `Batch ID "${batchId}" was not found on IndexInstantly.`,
            statusCode: 404,
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'PROVIDER_ERROR',
          message: errorBody?.message || `IndexInstantly returned HTTP ${res.status}`,
          statusCode: res.status,
        },
      };
    }

    const data = await res.json();
    const rawStatus = (data.status || 'queued').toLowerCase();
    const normalized = normalizeProviderStatus(rawStatus);

    return {
      success: true,
      data: {
        batch_id: String(data.batch_id || batchId),
        status: rawStatus,
        normalizedStatus: normalized,
        accepted: data.accepted,
        completed: data.completed,
        urls: data.urls,
        raw: data,
      },
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: {
          code: 'REQUEST_TIMEOUT',
          message: 'IndexInstantly status check timed out.',
          statusCode: 504,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: err.message || 'Failed to query IndexInstantly status.',
        statusCode: 503,
      },
    };
  }
}
