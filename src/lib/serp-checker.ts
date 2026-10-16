/**
 * REAL-TIME GOOGLE INDEX STATUS CHECKER
 * 
 * Performs an authentic check against Google's search index (SERP)
 * to verify if a target canonical URL has been placed into Google's public index.
 * 
 * CRITICAL VERIFICATION RULES:
 * 1. Never show "CONFIRMED INDEXED" unless a genuine Google SERP response
 *    contains an organic search result matching the exact submitted URL
 *    (after URL normalization and canonical/redirect handling).
 * 2. A site: query that returns 0 results or returns results for other pages/domain
 *    must NEVER count as proof of indexing.
 * 3. Rate-limited (HTTP 429), CAPTCHA (/sorry/index), blocked, timed out, or inconclusive
 *    checks MUST evaluate to UNABLE_TO_VERIFY (isIndexed: false), never success.
 * 4. Never fabricate Googlebot crawl events, Google API results, timestamps, or indexing status.
 */

import { normalizeUrl } from './property-matcher';

export type GoogleVerificationState = 'CONFIRMED_INDEXED' | 'NOT_INDEXED' | 'UNABLE_TO_VERIFY';

export interface GoogleIndexCheckResult {
  targetUrl: string;
  isIndexed: boolean; // Strictly true ONLY when verificationState === 'CONFIRMED_INDEXED'
  verificationState: GoogleVerificationState;
  statusText: string;
  checkedAt: string;
  googleSearchUrl: string;
  details: string;
  matchedResultUrl?: string;
  candidateCount?: number;
}

export interface CheckGoogleIndexOptions {
  customFetch?: typeof fetch;
  timeoutMs?: number;
  canonicalUrl?: string;
}

/**
 * Normalizes two URLs and checks whether they point to the exact same resource.
 * Handles protocol variations (http vs https), trailing slashes, www subdomains,
 * case-insensitive paths, and strips tracking parameters (utm_*, fbclid).
 * 
 * Subdomains, sibling pages, parent directories, or different paths return FALSE.
 */
export function areUrlsEquivalent(urlAStr: string, urlBStr: string): boolean {
  if (!urlAStr || !urlBStr) return false;
  try {
    const normA = normalizeUrl(urlAStr).url;
    const normB = normalizeUrl(urlBStr).url;
    if (!normA || !normB) return false;

    // Compare hostnames: case-insensitive, strip optional www. prefix
    const hostA = normA.hostname.toLowerCase().replace(/^www\./, '');
    const hostB = normB.hostname.toLowerCase().replace(/^www\./, '');
    if (hostA !== hostB) return false;

    // Compare paths: normalize trailing slashes and URI decoding
    const cleanPath = (p: string) => {
      let decoded = p;
      try {
        decoded = decodeURIComponent(p);
      } catch {}
      return (decoded.replace(/\/+$/, '') || '/').toLowerCase();
    };

    const pathA = cleanPath(normA.pathname);
    const pathB = cleanPath(normB.pathname);
    if (pathA !== pathB) return false;

    // Compare non-tracking query parameters
    const getSignificantParams = (url: URL) => {
      const ignoredPrefixes = ['utm_', 'fbclid', 'gclid', '_ga', 'ref'];
      const params: Array<[string, string]> = [];
      url.searchParams.forEach((val, key) => {
        const lowerKey = key.toLowerCase();
        if (!ignoredPrefixes.some((prefix) => lowerKey.startsWith(prefix))) {
          params.push([lowerKey, val]);
        }
      });
      params.sort(([a], [b]) => a.localeCompare(b));
      return JSON.stringify(params);
    };

    const paramsA = getSignificantParams(normA);
    const paramsB = getSignificantParams(normB);
    if (paramsA !== paramsB) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a hostname belongs to Google internal or ancillary search domains
 */
function isGoogleOrInfraHost(hostname: string, targetHost: string): boolean {
  const lower = hostname.toLowerCase();
  if (targetHost && lower === targetHost.toLowerCase()) {
    return false;
  }

  // Google properties
  if (lower === 'google.com' || lower.endsWith('.google.com')) return true;
  if (/^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(lower)) return true; // google.co.uk, google.de, etc.
  if (lower === 'googleusercontent.com' || lower.endsWith('.googleusercontent.com')) return true;
  if (lower === 'gstatic.com' || lower.endsWith('.gstatic.com')) return true;
  if (lower === 'googleapis.com' || lower.endsWith('.googleapis.com')) return true;
  if (lower === 'schema.org' || lower.endsWith('.schema.org')) return true;
  if (lower === 'w3.org' || lower.endsWith('.w3.org')) return true;

  // Youtube unless target is youtube
  if (!targetHost.includes('youtube.com') && (lower === 'youtube.com' || lower.endsWith('.youtube.com'))) {
    return true;
  }

  return false;
}

/**
 * Extracts candidate external organic result URLs from Google SERP HTML.
 * Parses Google redirect wrappers (/url?q=...) and direct external href links.
 * Explicitly ignores search input boxes, textarea query values, and Google internal navigation.
 */
export function extractSerpResultUrls(html: string, targetUrl?: string): string[] {
  if (!html) return [];

  const targetHost = targetUrl ? (normalizeUrl(targetUrl).url?.hostname || '') : '';
  const candidates = new Set<string>();

  // 1. Extract Google redirect wrappers: href="/url?q=https%3A%2F%2F...&..."
  const redirectRegex = /href=["']\/url\?q=([^&"'>\s]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = redirectRegex.exec(html)) !== null) {
    try {
      const decoded = decodeURIComponent(match[1]);
      const parsed = new URL(decoded);
      if (['http:', 'https:'].includes(parsed.protocol) && !isGoogleOrInfraHost(parsed.hostname, targetHost)) {
        candidates.add(decoded);
      }
    } catch {
      // Ignore invalid URLs
    }
  }

  // 2. Extract direct anchor links: <a ... href="https://..." ...>
  // Exclude input/textarea values by strictly targeting anchor tag hrefs
  const anchorRegex = /<a\b[^>]*?\bhref=["'](https?:\/\/[^"'>\s]+)["'][^>]*>/gi;
  while ((match = anchorRegex.exec(html)) !== null) {
    try {
      const rawUrl = match[1].replace(/&amp;/g, '&');
      const parsed = new URL(rawUrl);
      if (!isGoogleOrInfraHost(parsed.hostname, targetHost)) {
        candidates.add(rawUrl);
      }
    } catch {
      // Ignore invalid URLs
    }
  }

  // 3. Extract links from <cite> tags if they contain full URLs
  const citeRegex = /<cite\b[^>]*>([\s\S]*?)<\/cite>/gi;
  while ((match = citeRegex.exec(html)) !== null) {
    const citeText = match[1].replace(/<[^>]+>/g, '').trim();
    if (/^https?:\/\//i.test(citeText)) {
      try {
        const rawUrl = citeText.split(/\s/)[0];
        const parsed = new URL(rawUrl);
        if (!isGoogleOrInfraHost(parsed.hostname, targetHost)) {
          candidates.add(rawUrl);
        }
      } catch {
        // Ignore
      }
    }
  }

  return Array.from(candidates);
}

/**
 * Detects whether Google blocked, rate-limited, or presented a CAPTCHA challenge
 */
export function detectGoogleBlock(status: number, html: string): { isBlocked: boolean; reason?: string } {
  if (status === 429) {
    return {
      isBlocked: true,
      reason: 'HTTP 429 Too Many Requests: Google automated search query rate limit reached.',
    };
  }

  if (status === 403) {
    return {
      isBlocked: true,
      reason: 'HTTP 403 Forbidden: Google search access denied by automated protection.',
    };
  }

  if (status >= 500) {
    return {
      isBlocked: true,
      reason: `HTTP ${status}: Google search service temporarily unavailable.`,
    };
  }

  if (status !== 200) {
    return {
      isBlocked: true,
      reason: `HTTP ${status}: Unexpected response received from Google search endpoint.`,
    };
  }

  // Inspect HTML content for anti-bot / CAPTCHA challenge signatures
  const blockSignatures = [
    '/sorry/index',
    'detected unusual traffic',
    'systems have detected unusual traffic',
    'id="captcha-form"',
    'name="captcha"',
    'class="g-recaptcha"',
    'recaptcha/api.js',
    'action="CaptchaRedirect"',
    'please solve this challenge',
    '/httpservice/retry/enablejs',
    'enablejs?sei=',
    'Update your browser',
    'Your browser is not supported anymore',
  ];

  for (const sig of blockSignatures) {
    if (html.includes(sig)) {
      const isJsChallenge = sig.includes('enablejs') || sig.includes('browser');
      return {
        isBlocked: true,
        reason: isJsChallenge
          ? 'Google automated query protection (anti-bot challenge / JavaScript required).'
          : 'Google CAPTCHA or unusual traffic anti-bot challenge detected.',
      };
    }
  }

  return { isBlocked: false };
}

/**
 * Checks whether Google SERP response explicitly reports zero matching documents
 */
export function detectGoogleNoResults(html: string): boolean {
  const notIndexedPhrases = [
    'did not match any documents',
    'No results found for',
    'Make sure that all words are spelled correctly',
    'Try different keywords',
    'Try more general keywords',
  ];

  return notIndexedPhrases.some((phrase) => html.includes(phrase));
}

/**
 * Checks whether Google has genuinely indexed the exact URL into public search results.
 * Strictly adheres to truth in verification:
 * - Only returns isIndexed: true when the exact canonical URL is found in genuine SERP results.
 * - Inconclusive, blocked, or timed out queries return UNABLE_TO_VERIFY (isIndexed: false).
 * - Queries with no exact match return NOT_INDEXED (isIndexed: false).
 */
export async function checkGoogleIndexStatus(
  targetUrl: string,
  options?: CheckGoogleIndexOptions
): Promise<GoogleIndexCheckResult> {
  const { url: parsedTarget, error: parseError } = normalizeUrl(targetUrl);
  const nowIso = new Date().toISOString();

  if (!parsedTarget || parseError) {
    return {
      targetUrl,
      isIndexed: false,
      verificationState: 'UNABLE_TO_VERIFY',
      statusText: 'UNABLE_TO_VERIFY',
      checkedAt: nowIso,
      googleSearchUrl: `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`,
      details: `Invalid target URL syntax: ${parseError || 'Malformed URL'}`,
    };
  }

  const normalizedTargetStr = parsedTarget.toString();
  const googleSearchUrl = `https://www.google.com/search?q=site:${encodeURIComponent(normalizedTargetStr)}&hl=en`;
  const fetchFn = options?.customFetch || fetch;
  const timeoutMs = options?.timeoutMs || 6000;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetchFn(googleSearchUrl, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    }).catch((fetchErr: any) => {
      return { error: fetchErr } as any;
    });

    clearTimeout(timeoutId);

    // 1. Handle fetch errors / timeouts / aborts
    if (!res || res.error || typeof res.text !== 'function') {
      const errDetail = res?.error?.name === 'AbortError'
        ? `Request timed out after ${timeoutMs}ms`
        : res?.error?.message || 'Network request failed';

      return {
        targetUrl,
        isIndexed: false,
        verificationState: 'UNABLE_TO_VERIFY',
        statusText: 'UNABLE_TO_VERIFY',
        checkedAt: nowIso,
        googleSearchUrl,
        details: `Unable to verify Google SERP status: ${errDetail}. Check live SERP directly via 'Open on Google'.`,
      };
    }

    const html = await res.text();
    const status = res.status || 200;

    // 2. Check for anti-bot blocks, rate limits, or CAPTCHA challenges
    const blockCheck = detectGoogleBlock(status, html);
    if (blockCheck.isBlocked) {
      return {
        targetUrl,
        isIndexed: false,
        verificationState: 'UNABLE_TO_VERIFY',
        statusText: 'UNABLE_TO_VERIFY',
        checkedAt: nowIso,
        googleSearchUrl,
        details: `Unable to verify Google SERP live: ${blockCheck.reason || 'Google automated protection active'}. Please verify directly via 'Open on Google'.`,
      };
    }

    // 3. Extract candidate organic result URLs from the SERP HTML
    const candidates = extractSerpResultUrls(html, normalizedTargetStr);
    const hasZeroResultsNotice = detectGoogleNoResults(html);

    // 4. Exact canonical URL matching against extracted candidate results
    let matchedResultUrl: string | undefined;

    for (const candidate of candidates) {
      if (areUrlsEquivalent(normalizedTargetStr, candidate)) {
        matchedResultUrl = candidate;
        break;
      }
      if (options?.canonicalUrl && areUrlsEquivalent(options.canonicalUrl, candidate)) {
        matchedResultUrl = candidate;
        break;
      }
    }

    // 5. Positive verification: exact URL was found in search results
    if (matchedResultUrl) {
      return {
        targetUrl,
        isIndexed: true,
        verificationState: 'CONFIRMED_INDEXED',
        statusText: 'CONFIRMED_INDEXED',
        checkedAt: nowIso,
        googleSearchUrl,
        matchedResultUrl,
        candidateCount: candidates.length,
        details: `Confirmed! Exact URL appears in live Google search results (${matchedResultUrl}).`,
      };
    }

    // 6. Explicit 0 results notice from Google
    if (hasZeroResultsNotice || candidates.length === 0) {
      return {
        targetUrl,
        isIndexed: false,
        verificationState: 'NOT_INDEXED',
        statusText: 'NOT_INDEXED',
        checkedAt: nowIso,
        googleSearchUrl,
        candidateCount: 0,
        details: 'Google search returned 0 results for this URL query. The URL is not currently indexed in Google public SERP.',
      };
    }

    // 7. Results were returned (e.g. for domain or sibling pages), but exact submitted URL is not present
    return {
      targetUrl,
      isIndexed: false,
      verificationState: 'NOT_INDEXED',
      statusText: 'NOT_INDEXED',
      checkedAt: nowIso,
      googleSearchUrl,
      candidateCount: candidates.length,
      details: `Google search returned ${candidates.length} result(s) for this query, but none match the exact submitted canonical URL. The URL is not currently indexed in Google public SERP.`,
    };
  } catch (err: any) {
    return {
      targetUrl,
      isIndexed: false,
      verificationState: 'UNABLE_TO_VERIFY',
      statusText: 'UNABLE_TO_VERIFY',
      checkedAt: nowIso,
      googleSearchUrl,
      details: `Unable to verify Google SERP live: ${err.message || 'Unexpected verification error'}. Please verify directly via 'Open on Google'.`,
    };
  }
}
