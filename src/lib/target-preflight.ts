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
  contentLength?: number;
  isPdf: boolean;
  isPdfSignatureValid?: boolean;
  finalUrl: string;
  redirectCount: number;
  xRobotsTag?: string | null;
  robotsTxtStatus?: 'ALLOWED' | 'DISALLOWED' | 'NOT_FOUND' | 'ERROR';
  canonicalUrl?: string | null;
  isDisguisedHtml?: boolean;
  authRequired?: boolean;
  errorMessage?: string;
  warningMessage?: string;
  latencyMs: number;
  checkedAt?: string;
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
 * Inspects target host robots.txt restrictions for search engine crawlers.
 */
export async function inspectRobotsTxtForUrl(
  targetUrl: string,
  timeoutMs: number = 2500
): Promise<{ status: 'ALLOWED' | 'DISALLOWED' | 'NOT_FOUND' | 'ERROR'; warning?: string }> {
  try {
    const parsed = new URL(targetUrl);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
    const ssrf = await validateUrlForSSRF(robotsUrl);
    if (!ssrf.isSafe) return { status: 'ALLOWED' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(robotsUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) IndexMatrixBot/1.0' },
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timer);

    if (!res) return { status: 'ERROR' };
    if (res.status === 404) return { status: 'NOT_FOUND' };
    if (!res.ok) return { status: 'ERROR' };

    const text = await res.text().catch(() => '');
    const path = parsed.pathname;

    const lines = text.split(/\r?\n/);
    let appliesToUs = false;
    let disallowed = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#') || !line) continue;
      const lower = line.toLowerCase();
      if (lower.startsWith('user-agent:')) {
        const ua = lower.replace('user-agent:', '').trim();
        appliesToUs = ua === '*' || ua.includes('googlebot');
      } else if (appliesToUs && lower.startsWith('disallow:')) {
        const dispath = line.slice(9).trim();
        if (dispath === '/' || (dispath && path.startsWith(dispath))) {
          disallowed = true;
          break;
        }
      }
    }

    if (disallowed) {
      return {
        status: 'DISALLOWED',
        warning: 'Target website robots.txt disallows search engine crawlers from accessing this path.',
      };
    }

    return { status: 'ALLOWED' };
  } catch {
    return { status: 'ALLOWED' };
  }
}

/**
 * Extracts canonical URL from HTTP Link header.
 */
function extractCanonicalFromHeaders(headers: Headers): string | null {
  const link = headers.get('link');
  if (!link) return null;
  const match = link.match(/<([^>]+)>;\s*rel="?canonical"?/i);
  return match ? match[1] : null;
}

/**
 * Extracts Content-Length header safely.
 */
function extractContentLength(headers: Headers, sampleLength: number): number | undefined {
  const cl = headers.get('content-length');
  if (cl && /^\d+$/.test(cl.trim())) {
    return parseInt(cl.trim(), 10);
  }
  return sampleLength > 0 ? sampleLength : undefined;
}

/**
 * Checks for HTML error pages disguised as PDFs or login gates.
 */
function analyzeHtmlSample(
  sampleBytes: Uint8Array,
  isTargetPdf: boolean,
  contentType: string
): {
  isDisguisedHtml: boolean;
  isSoft404: boolean;
  isAuthGate: boolean;
  reason?: string;
} {
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    return { isDisguisedHtml: false, isSoft404: false, isAuthGate: false };
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(sampleBytes).toLowerCase();

  const isAuth =
    text.includes('login') ||
    text.includes('sign in') ||
    text.includes('log in') ||
    text.includes('password') ||
    text.includes('authorization required') ||
    text.includes('access denied') ||
    text.includes('permission denied') ||
    text.includes('please log in to view');

  const isSoft404 =
    text.includes('404 not found') ||
    text.includes('attachment not found') ||
    text.includes('file not found') ||
    text.includes('document not found') ||
    text.includes('page not found') ||
    text.includes('topic not found') ||
    text.includes('thread not found') ||
    text.includes('does not exist') ||
    text.includes('invalid attachment');

  if (isTargetPdf) {
    return {
      isDisguisedHtml: true,
      isSoft404,
      isAuthGate: isAuth,
      reason: isAuth
        ? 'Target PDF is behind an authentication gate or login barrier. Crawlers cannot access authenticated resources.'
        : isSoft404
        ? 'Target URL returned an HTML error page disguised as a PDF (soft 404). Googlebot cannot index missing attachments.'
        : 'URL points to a .pdf resource, but server returned an HTML webpage without a PDF binary signature.',
    };
  }

  return {
    isDisguisedHtml: false,
    isSoft404,
    isAuthGate: isAuth,
  };
}

/**
 * Validates a target URL before fast index submission and credit deduction.
 * - Protects against SSRF / private IP addresses.
 * - Inspects HTTP status, Content-Type, and Content-Length.
 * - Uses HEAD first; falls back to a safe limited GET if HEAD is not supported or inconclusive.
 * - Inspects X-Robots-Tag, robots.txt restrictions, and canonical link headers.
 * - Detects application/pdf responses and verifies %PDF- binary signature.
 * - Detects HTML error pages disguised as PDFs (soft 404s and authentication barriers).
 * - Distinguishes confirmed dead (404/410) from access restricted (401/403), timeouts, and rate limits.
 * - Records timestamps for full auditability.
 */
export async function validateTargetPreflight(
  targetUrl: string,
  options?: { timeoutMs?: number; maxRedirects?: number; checkRobots?: boolean }
): Promise<TargetPreflightResult> {
  const startTime = Date.now();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options?.maxRedirects ?? MAX_REDIRECTS;
  const checkRobots = options?.checkRobots ?? false;

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
      checkedAt: new Date().toISOString(),
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
            checkedAt: new Date().toISOString(),
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
          checkedAt: new Date().toISOString(),
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
        checkedAt: new Date().toISOString(),
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
          checkedAt: new Date().toISOString(),
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
          checkedAt: new Date().toISOString(),
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
          checkedAt: new Date().toISOString(),
        };
      }

      currentUrl = nextUrl;
      redirectCount++;
      continue;
    }

    // Response reached destination (non-redirect)
    const contentType = (activeResponse.headers.get('content-type') || '').toLowerCase();
    const xRobots = (activeResponse.headers.get('x-robots-tag') || '').toLowerCase();
    const contentLength = extractContentLength(activeResponse.headers, sampleBytes.length);
    const canonicalUrl = extractCanonicalFromHeaders(activeResponse.headers);

    // 3. Status Code Analysis
    // 3a. Confirmed Dead Targets (404 Not Found, 410 Gone)
    if (currentStatus === 404 || currentStatus === 410) {
      return {
        canDispatch: false,
        isDead: true,
        status: 'CONFIRMED_DEAD',
        httpStatus: currentStatus,
        contentType,
        contentLength,
        isPdf: isTargetPdf,
        finalUrl: currentUrl,
        redirectCount,
        xRobotsTag: xRobots || null,
        canonicalUrl,
        errorMessage: `Target URL returned HTTP ${currentStatus} (${currentStatus === 404 ? 'Not Found' : 'Gone'}). Confirmed dead link. Googlebot cannot index non-existent resources.`,
        latencyMs: Date.now() - startTime,
        checkedAt: new Date().toISOString(),
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
        contentLength,
        isPdf: isTargetPdf,
        finalUrl: currentUrl,
        redirectCount,
        xRobotsTag: xRobots || null,
        canonicalUrl,
        authRequired: true,
        errorMessage: `Target server returned HTTP ${currentStatus} (Access Restricted/Forbidden). Destination cannot be accessed by external crawlers.`,
        latencyMs: Date.now() - startTime,
        checkedAt: new Date().toISOString(),
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
        contentLength,
        isPdf: isTargetPdf,
        finalUrl: currentUrl,
        redirectCount,
        xRobotsTag: xRobots || null,
        canonicalUrl,
        errorMessage: `Target server returned HTTP 429 (Rate Limited). Server is throttling crawler requests.`,
        latencyMs: Date.now() - startTime,
        checkedAt: new Date().toISOString(),
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
        contentLength,
        isPdf: isTargetPdf,
        finalUrl: currentUrl,
        redirectCount,
        xRobotsTag: xRobots || null,
        canonicalUrl,
        errorMessage: `Target origin server returned HTTP ${currentStatus} (Internal Server Error). Destination is temporarily unreachable.`,
        latencyMs: Date.now() - startTime,
        checkedAt: new Date().toISOString(),
      };
    }

    // 3e. Successful HTTP 2xx Response
    if (currentStatus >= 200 && currentStatus < 300) {
      const isPdfMime = contentType.includes('application/pdf') || contentType.includes('application/x-pdf');
      const hasMagic = sampleBytes.length >= 5 ? checkPdfMagicBytes(sampleBytes) : undefined;
      const isPdf = isTargetPdf || isPdfMime || Boolean(hasMagic);

      // Check for disguised HTML / soft 404 / login gate
      const htmlAnalysis = analyzeHtmlSample(sampleBytes, isTargetPdf, contentType);

      if (isTargetPdf && htmlAnalysis.isDisguisedHtml && hasMagic === false) {
        if (htmlAnalysis.isAuthGate) {
          return {
            canDispatch: false,
            isDead: false,
            status: 'ACCESS_RESTRICTED',
            httpStatus: currentStatus,
            contentType,
            contentLength,
            isPdf: false,
            isPdfSignatureValid: false,
            finalUrl: currentUrl,
            redirectCount,
            xRobotsTag: xRobots || null,
            canonicalUrl,
            isDisguisedHtml: true,
            authRequired: true,
            errorMessage: htmlAnalysis.reason,
            latencyMs: Date.now() - startTime,
            checkedAt: new Date().toISOString(),
          };
        }

        if (htmlAnalysis.isSoft404) {
          return {
            canDispatch: false,
            isDead: true,
            status: 'CONFIRMED_DEAD',
            httpStatus: currentStatus,
            contentType,
            contentLength,
            isPdf: false,
            isPdfSignatureValid: false,
            finalUrl: currentUrl,
            redirectCount,
            xRobotsTag: xRobots || null,
            canonicalUrl,
            isDisguisedHtml: true,
            errorMessage: htmlAnalysis.reason,
            latencyMs: Date.now() - startTime,
            checkedAt: new Date().toISOString(),
          };
        }

        return {
          canDispatch: false,
          isDead: false,
          status: 'INVALID_CONTENT_TYPE',
          httpStatus: currentStatus,
          contentType,
          contentLength,
          isPdf: false,
          isPdfSignatureValid: false,
          finalUrl: currentUrl,
          redirectCount,
          xRobotsTag: xRobots || null,
          canonicalUrl,
          isDisguisedHtml: true,
          errorMessage: htmlAnalysis.reason || 'Target URL declared as PDF but server returned HTML content.',
          latencyMs: Date.now() - startTime,
          checkedAt: new Date().toISOString(),
        };
      }

      let warningMessage: string | undefined;

      if (xRobots.includes('noindex') || xRobots.includes('none')) {
        warningMessage = 'Target server returned X-Robots-Tag: noindex header. Search engines are instructed not to index this resource.';
      }

      let robotsTxtStatus: 'ALLOWED' | 'DISALLOWED' | 'NOT_FOUND' | 'ERROR' = 'ALLOWED';
      if (checkRobots) {
        const rCheck = await inspectRobotsTxtForUrl(currentUrl);
        robotsTxtStatus = rCheck.status;
        if (rCheck.warning && !warningMessage) {
          warningMessage = rCheck.warning;
        }
      }

      return {
        canDispatch: true,
        isDead: false,
        status: 'ACTIVE',
        httpStatus: currentStatus,
        contentType,
        contentLength,
        isPdf,
        isPdfSignatureValid: hasMagic,
        finalUrl: currentUrl,
        redirectCount,
        xRobotsTag: xRobots || null,
        robotsTxtStatus,
        canonicalUrl,
        isDisguisedHtml: false,
        warningMessage,
        latencyMs: Date.now() - startTime,
        checkedAt: new Date().toISOString(),
      };
    }

    // Other unexpected HTTP codes
    return {
      canDispatch: false,
      isDead: false,
      status: 'INCONCLUSIVE',
      httpStatus: currentStatus,
      contentType,
      contentLength,
      isPdf: isTargetPdf,
      finalUrl: currentUrl,
      redirectCount,
      xRobotsTag: xRobots || null,
      canonicalUrl,
      errorMessage: `Target host returned unexpected HTTP status ${currentStatus}.`,
      latencyMs: Date.now() - startTime,
      checkedAt: new Date().toISOString(),
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
    checkedAt: new Date().toISOString(),
  };
}
