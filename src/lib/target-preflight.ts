import { validateUrlForSSRF } from './ssrf';

export type PreflightStatus =
  | 'ACTIVE'
  | 'CONFIRMED_DEAD'
  | 'ACCESS_RESTRICTED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'BLOCKED_SSRF'
  | 'INVALID_CONTENT_TYPE'
  | 'INCONCLUSIVE';

export interface TargetPreflightResult {
  canDispatch: boolean;
  isDead: boolean;
  status: PreflightStatus;
  httpStatus: number;
  contentType: string;
  isPdf: boolean;
  isPdfSignatureValid?: boolean;
  finalUrl: string;
  redirectCount: number;
  errorMessage?: string;
  warningMessage?: string;
  latencyMs: number;
}

const DEFAULT_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 5;
const MAX_PREFLIGHT_READ_BYTES = 4096;

/**
 * Safely reads up to maxBytes from a Response body stream, then releases/aborts the reader.
 */
async function readLimitedBodyBytes(res: Response, maxBytes: number = MAX_PREFLIGHT_READ_BYTES): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const bytesToTake = Math.min(value.length, maxBytes - totalBytes);
      chunks.push(value.slice(0, bytesToTake));
      totalBytes += bytesToTake;
    }
  } catch {
    // Stream closed or truncated gracefully
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancellation error
    }
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Checks for standard %PDF- magic bytes (0x25, 0x50, 0x44, 0x46, 0x2D)
 */
export function checkPdfMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  return (
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d    // -
  );
}

/**
 * Validates a target URL before fast index submission and credit deduction.
 * - Protects against SSRF / private IP addresses.
 * - Inspects HTTP status and content type.
 * - Uses HEAD first; falls back to a safe limited GET if HEAD is not supported or inconclusive.
 * - Distinguishes confirmed dead (404/410) from access restricted (403), timeouts, and rate limits.
 */
export async function validateTargetPreflight(
  targetUrl: string,
  options?: { timeoutMs?: number; maxRedirects?: number }
): Promise<TargetPreflightResult> {
  const startTime = Date.now();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options?.maxRedirects ?? MAX_REDIRECTS;

  let currentUrl = targetUrl;
  let redirectCount = 0;

  // 1. Initial SSRF firewall check
  const initialSsrf = await validateUrlForSSRF(currentUrl);
  if (!initialSsrf.isSafe) {
    return {
      canDispatch: false,
      isDead: false,
      status: 'BLOCKED_SSRF',
      httpStatus: 0,
      contentType: '',
      isPdf: false,
      finalUrl: currentUrl,
      redirectCount: 0,
      errorMessage: `Blocked by SSRF security policy: ${initialSsrf.reason || 'Protected or private target'}`,
      latencyMs: Date.now() - startTime,
    };
  }

  // 2. Fetch loop with redirect tracking and HEAD-first probing
  while (redirectCount <= maxRedirects) {
    const isTargetPdf = currentUrl.toLowerCase().split('?')[0].endsWith('.pdf');

    // Attempt lightweight HEAD probe first
    let headResponse: Response | null = null;
    let headError: any = null;

    const headController = new AbortController();
    const headTimer = setTimeout(() => headController.abort(), timeoutMs);

    try {
      headResponse = await fetch(currentUrl, {
        method: 'HEAD',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 IndexMatrixBot/1.0',
          Accept: 'application/pdf,text/html,*/*;q=0.8',
        },
        redirect: 'manual',
        signal: headController.signal,
      });
    } catch (err: any) {
      headError = err;
    } finally {
      clearTimeout(headTimer);
    }

    // Determine if we need limited GET fallback:
    // Fall back to GET if:
    // - HEAD failed with network error or timeout
    // - HEAD returned method not allowed (405, 501, 400)
    // - HEAD returned 403 (some CDNs/WAFs block HEAD requests specifically)
    // - HEAD returned 404 or 410 (to definitively verify it is actually dead on GET)
    // - Target appears to be a PDF and we need magic bytes inspection
    const headStatus = headResponse ? headResponse.status : 0;
    const isHeadUnsupportedOrInconclusive =
      !headResponse ||
      [400, 403, 404, 405, 410, 501].includes(headStatus) ||
      (isTargetPdf && headStatus >= 200 && headStatus < 300);

    let activeResponse: Response | null = headResponse;
    let sampleBytes: Uint8Array = new Uint8Array(0);

    if (isHeadUnsupportedOrInconclusive) {
      const getController = new AbortController();
      const getTimer = setTimeout(() => getController.abort(), timeoutMs);

      try {
        const getRes = await fetch(currentUrl, {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 IndexMatrixBot/1.0',
            Accept: 'application/pdf,text/html,*/*;q=0.8',
            Range: 'bytes=0-4095',
          },
          redirect: 'manual',
          signal: getController.signal,
        });

        // Read limited sample bytes safely
        sampleBytes = await readLimitedBodyBytes(getRes, MAX_PREFLIGHT_READ_BYTES);
        activeResponse = getRes;
      } catch (getErr: any) {
        clearTimeout(getTimer);
        // If GET also failed:
        if (getErr.name === 'AbortError' || headError?.name === 'AbortError') {
          return {
            canDispatch: false,
            isDead: false,
            status: 'TIMEOUT',
            httpStatus: 0,
            contentType: '',
            isPdf: isTargetPdf,
            finalUrl: currentUrl,
            redirectCount,
            errorMessage: `Target host timed out after ${timeoutMs / 1000}s during reachability check.`,
            latencyMs: Date.now() - startTime,
          };
        }

        return {
          canDispatch: false,
          isDead: false,
          status: 'NETWORK_ERROR',
          httpStatus: 0,
          contentType: '',
          isPdf: isTargetPdf,
          finalUrl: currentUrl,
          redirectCount,
          errorMessage: `Network error reaching target host: ${getErr.message || headError?.message || 'Connection reset or unreachable'}`,
          latencyMs: Date.now() - startTime,
        };
      } finally {
        clearTimeout(getTimer);
      }
    }

    if (!activeResponse) {
      return {
        canDispatch: false,
        isDead: false,
        status: 'INCONCLUSIVE',
        httpStatus: 0,
        contentType: '',
        isPdf: isTargetPdf,
        finalUrl: currentUrl,
        redirectCount,
        errorMessage: 'Unable to receive HTTP response from target host.',
        latencyMs: Date.now() - startTime,
      };
    }

    const currentStatus = activeResponse.status;

    // Handle Redirects (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(currentStatus)) {
      const location = activeResponse.headers.get('location');
      if (!location) {
        return {
          canDispatch: false,
          isDead: false,
          status: 'INCONCLUSIVE',
          httpStatus: currentStatus,
          contentType: activeResponse.headers.get('content-type') || '',
          isPdf: isTargetPdf,
          finalUrl: currentUrl,
          redirectCount,
          errorMessage: `Received HTTP ${currentStatus} redirect without Location header.`,
          latencyMs: Date.now() - startTime,
        };
      }

      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        return {
          canDispatch: false,
          isDead: false,
          status: 'INCONCLUSIVE',
          httpStatus: currentStatus,
          contentType: activeResponse.headers.get('content-type') || '',
          isPdf: isTargetPdf,
          finalUrl: currentUrl,
          redirectCount,
          errorMessage: `Malformed redirect destination URL in Location header: "${location}".`,
          latencyMs: Date.now() - startTime,
        };
      }

      // Re-verify SSRF on redirected hop
      const redirectSsrf = await validateUrlForSSRF(nextUrl);
      if (!redirectSsrf.isSafe) {
        return {
          canDispatch: false,
          isDead: false,
          status: 'BLOCKED_SSRF',
          httpStatus: currentStatus,
          contentType: '',
          isPdf: isTargetPdf,
          finalUrl: nextUrl,
          redirectCount: redirectCount + 1,
          errorMessage: `Redirect destination blocked by SSRF policy: ${redirectSsrf.reason}`,
          latencyMs: Date.now() - startTime,
        };
      }

      currentUrl = nextUrl;
      redirectCount++;
      continue;
    }

    // Response reached destination (non-redirect)
    const contentType = (activeResponse.headers.get('content-type') || '').toLowerCase();
    const xRobots = (activeResponse.headers.get('x-robots-tag') || '').toLowerCase();

    // 3. Status Code Analysis
    // 3a. Confirmed Dead Targets (404 Not Found, 410 Gone)
    if (currentStatus === 404 || currentStatus === 410) {
      return {
        canDispatch: false,
        isDead: true,
        status: 'CONFIRMED_DEAD',
        httpStatus: currentStatus,
        contentType,
        isPdf: isTargetPdf,
        finalUrl: currentUrl,
        redirectCount,
        errorMessage: `Target URL returned HTTP ${currentStatus} (${currentStatus === 404 ? 'Not Found' : 'Gone'}). Confirmed dead link. Googlebot cannot index non-existent resources.`,
        latencyMs: Date.now() - startTime,
      };
    }

    // 3b. Access Restricted / Forbidden (401 Unauthorized, 403 Forbidden)
    if (currentStatus === 401 || currentStatus === 403) {
      return {
        canDispatch: false,
        isDead: false,
        status: 'ACCESS_RESTRICTED',
        httpStatus: currentStatus,
        contentType,
        isPdf: isTargetPdf,
        finalUrl: currentUrl,
        redirectCount,
        errorMessage: `Target server returned HTTP ${currentStatus} (Access Restricted/Forbidden). Destination cannot be accessed by external crawlers.`,
        latencyMs: Date.now() - startTime,
      };
    }

    // 3c. Rate Limited (429 Too Many Requests)
    if (currentStatus === 429) {
      return {
        canDispatch: false,
        isDead: false,
        status: 'RATE_LIMITED',
        httpStatus: currentStatus,
        contentType,
        isPdf: isTargetPdf,
        finalUrl: currentUrl,
        redirectCount,
        errorMessage: `Target server returned HTTP 429 (Rate Limited). Server is throttling crawler requests.`,
        latencyMs: Date.now() - startTime,
      };
    }

    // 3d. Origin Server Errors (500 - 599)
    if (currentStatus >= 500 && currentStatus <= 599) {
      return {
        canDispatch: false,
        isDead: false,
        status: 'SERVER_ERROR',
        httpStatus: currentStatus,
        contentType,
        isPdf: isTargetPdf,
        finalUrl: currentUrl,
        redirectCount,
        errorMessage: `Target origin server returned HTTP ${currentStatus} (Internal Server Error). Destination is temporarily unreachable.`,
        latencyMs: Date.now() - startTime,
      };
    }

    // 3e. Successful HTTP 2xx Response
    if (currentStatus >= 200 && currentStatus < 300) {
      const isPdfMime = contentType.includes('application/pdf') || contentType.includes('application/x-pdf');
      const hasMagic = sampleBytes.length >= 5 ? checkPdfMagicBytes(sampleBytes) : undefined;
      const isPdf = isTargetPdf || isPdfMime || Boolean(hasMagic);

      let warningMessage: string | undefined;

      if (xRobots.includes('noindex')) {
        warningMessage = 'Target server returned X-Robots-Tag: noindex header. Search engines are instructed not to index this resource.';
      } else if (isTargetPdf && contentType.includes('text/html') && hasMagic === false) {
        warningMessage = 'URL ends with .pdf but server returned HTML content (possible soft 404 or login gate).';
      }

      return {
        canDispatch: true,
        isDead: false,
        status: 'ACTIVE',
        httpStatus: currentStatus,
        contentType,
        isPdf,
        isPdfSignatureValid: hasMagic,
        finalUrl: currentUrl,
        redirectCount,
        warningMessage,
        latencyMs: Date.now() - startTime,
      };
    }

    // Other unexpected HTTP codes
    return {
      canDispatch: false,
      isDead: false,
      status: 'INCONCLUSIVE',
      httpStatus: currentStatus,
      contentType,
      isPdf: isTargetPdf,
      finalUrl: currentUrl,
      redirectCount,
      errorMessage: `Target host returned unexpected HTTP status ${currentStatus}.`,
      latencyMs: Date.now() - startTime,
    };
  }

  // Exceeded max redirects
  return {
    canDispatch: false,
    isDead: false,
    status: 'INCONCLUSIVE',
    httpStatus: 0,
    contentType: '',
    isPdf: false,
    finalUrl: currentUrl,
    redirectCount,
    errorMessage: `Exceeded maximum redirect hop limit (${maxRedirects}). Possible redirect loop.`,
    latencyMs: Date.now() - startTime,
  };
}
