/**
 * Google Search Console Property Matching Engine
 *
 * Implements strict, official Google Search Console property matching rules:
 * 1. Domain Properties:
 *    Format: "sc-domain:domain.tld"
 *    Matches: Any URL on domain.tld or any of its subdomains (e.g. www.domain.tld, blog.domain.tld)
 *    across all protocols (http, https) and all ports.
 *    Vulnerability prevention: Never uses naive string startsWith comparisons (which would incorrectly
 *    match domain.tld.evil.com or notdomain.tld).
 *
 * 2. URL-Prefix Properties:
 *    Format: "https://domain.tld/path/"
 *    Matches: URLs that strictly match the exact protocol, domain, port, and start with the path prefix.
 */

export interface PropertyMatchResult {
  matches: boolean;
  propertyType: 'DOMAIN' | 'URL_PREFIX';
  matchedPropertyUrl: string;
  reason?: string;
}

/**
 * Normalizes a target URL for matching
 */
export function normalizeUrl(rawUrl: string): { url: URL | null; error?: string } {
  try {
    let clean = rawUrl.trim();
    if (/^[a-z0-9+.-]+:/i.test(clean) && !/^https?:\/\//i.test(clean)) {
      return { url: null, error: 'Only HTTP and HTTPS protocols are allowed' };
    }
    if (!/^https?:\/\//i.test(clean)) {
      clean = 'https://' + clean;
    }
    const parsed = new URL(clean);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { url: null, error: 'Only HTTP and HTTPS protocols are allowed' };
    }
    parsed.hostname = parsed.hostname.toLowerCase();
    // Strip trailing slash unless it's just "/"
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return { url: parsed };
  } catch (err: any) {
    return { url: null, error: err.message || 'Invalid URL' };
  }
}

/**
 * Tests whether a specific URL belongs to a given GSC property string
 */
export function matchesSearchConsoleProperty(targetUrl: string, propertyIdentifier: string): boolean {
  const { url, error } = normalizeUrl(targetUrl);
  if (!url || error) return false;

  const targetHost = url.hostname.toLowerCase();

  // Case 1: Domain Property (sc-domain:example.com)
  if (propertyIdentifier.startsWith('sc-domain:')) {
    const domain = propertyIdentifier.replace('sc-domain:', '').trim().toLowerCase();
    if (!domain) return false;

    // Exact domain match
    if (targetHost === domain) {
      return true;
    }

    // Subdomain match: must end with .domain
    if (targetHost.endsWith('.' + domain)) {
      return true;
    }

    return false;
  }

  // Case 2: URL-Prefix Property (e.g. https://example.com/ or https://example.com/blog/)
  try {
    const propUrl = new URL(propertyIdentifier);
    const propHost = propUrl.hostname.toLowerCase();

    // Protocol must match exactly (http vs https)
    if (url.protocol.toLowerCase() !== propUrl.protocol.toLowerCase()) {
      return false;
    }

    // Host must match exactly
    if (targetHost !== propHost) {
      return false;
    }

    // Port must match
    if (url.port !== propUrl.port) {
      return false;
    }

    // Path matching: Target path must start with property path prefix
    let propPath = propUrl.pathname;
    if (!propPath.endsWith('/')) {
      propPath += '/';
    }

    let targetPath = url.pathname;
    if (!targetPath.endsWith('/')) {
      targetPath += '/';
    }

    return targetPath.startsWith(propPath);
  } catch {
    return false;
  }
}

/**
 * Finds the best matching property from an array of authorized Search Console properties
 */
export function findBestMatchingProperty<T extends { id: string; propertyUrl: string }>(
  targetUrl: string,
  properties: T[]
): { property: T | null; matchType: 'EXACT_PREFIX' | 'DOMAIN' | null } {
  const matching = properties.filter(p => matchesSearchConsoleProperty(targetUrl, p.propertyUrl));

  if (matching.length === 0) {
    return { property: null, matchType: null };
  }

  // Prefer more specific URL-prefix properties over domain properties if both match
  const urlPrefixProps = matching.filter(p => !p.propertyUrl.startsWith('sc-domain:'));
  if (urlPrefixProps.length > 0) {
    // Sort by longest path prefix match (most specific)
    urlPrefixProps.sort((a, b) => b.propertyUrl.length - a.propertyUrl.length);
    return { property: urlPrefixProps[0], matchType: 'EXACT_PREFIX' };
  }

  return { property: matching[0], matchType: 'DOMAIN' };
}
