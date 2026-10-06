/**
 * Application Base URL & Public Feed Configuration
 * 
 * Centralized resolution and validation of APP_BASE_URL.
 * Enforces strict security and environment constraints:
 * - In Development: Allows http://localhost:3000 and custom ports.
 * - In Production: Requires a real public HTTPS URL; strictly forbids localhost,
 *   loopback, 127.0.0.1, 0.0.0.0, private IP ranges, and insecure HTTP.
 * - In Discovery Providers: Dynamically generates public feed and relay URLs.
 */

export interface AppBaseUrlValidationResult {
  valid: boolean;
  url: string;
  error?: string;
  isProduction: boolean;
}

const PRIVATE_OR_LOCAL_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
];

/**
 * Validates an application base URL against environment safety policies.
 */
export function validateAppBaseUrl(
  candidateUrl?: string | null,
  options?: { nodeEnv?: string; isBuildTime?: boolean }
): AppBaseUrlValidationResult {
  const env = options?.nodeEnv || process.env.NODE_ENV || 'development';
  const isProduction = env === 'production';

  // 1. Resolve candidate URL from argument or environment variables
  const raw = (
    candidateUrl !== undefined
      ? candidateUrl
      : process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  );

  const candidate = (raw || '').trim();

  // 2. Production Environment Constraints
  if (isProduction) {
    if (!candidate) {
      return {
        valid: false,
        url: '',
        error: 'Production configuration error: APP_BASE_URL environment variable is required in production.',
        isProduction: true,
      };
    }

    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return {
        valid: false,
        url: candidate,
        error: `Production configuration error: APP_BASE_URL "${candidate}" is not a valid URL.`,
        isProduction: true,
      };
    }

    // Must be HTTPS
    if (parsed.protocol !== 'https:') {
      return {
        valid: false,
        url: candidate,
        error: `Production configuration error: APP_BASE_URL must use the HTTPS protocol in production (received "${parsed.protocol}"). Insecure HTTP is prohibited.`,
        isProduction: true,
      };
    }

    // Must not be localhost, loopback, or private IP
    const hostname = parsed.hostname.toLowerCase();
    const isProhibited =
      PRIVATE_OR_LOCAL_HOSTNAMES.includes(hostname) ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);

    if (isProhibited) {
      return {
        valid: false,
        url: candidate,
        error: `Production configuration error: APP_BASE_URL cannot point to localhost or private/loopback IP address "${hostname}" in production. A real public domain is required.`,
        isProduction: true,
      };
    }

    // Normalized origin without trailing slash
    const normalized = `${parsed.protocol}//${parsed.host}`;
    return {
      valid: true,
      url: normalized,
      isProduction: true,
    };
  }

  // 3. Development / Test Environment Constraints
  if (!candidate) {
    return {
      valid: true,
      url: 'http://localhost:3000',
      isProduction: false,
    };
  }

  try {
    const parsed = new URL(candidate);
    const normalized = `${parsed.protocol}//${parsed.host}`;
    return {
      valid: true,
      url: normalized,
      isProduction: false,
    };
  } catch {
    return {
      valid: false,
      url: candidate,
      error: `Invalid URL format for APP_BASE_URL: "${candidate}".`,
      isProduction: false,
    };
  }
}

/**
 * Returns the normalized application base URL.
 * Throws in production if invalid or pointing to localhost/private IP.
 */
export function getAppBaseUrl(): string {
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
  const rawUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;

  // During static compilation phase (next build) in local dev, allow a fallback if not configured
  if (isBuildPhase && (!rawUrl || rawUrl.includes('localhost'))) {
    return 'https://indexmetrix.com';
  }

  const result = validateAppBaseUrl(rawUrl, {
    nodeEnv: process.env.NODE_ENV,
  });

  if (!result.valid) {
    throw new Error(result.error || 'Invalid APP_BASE_URL configuration');
  }

  return result.url;
}

/**
 * Dynamically constructs the public RSS discovery feed URL.
 */
export function getPublicFeedUrl(baseUrl?: string): string {
  const base = baseUrl ? validateAppBaseUrl(baseUrl).url : getAppBaseUrl();
  return `${base}/api/feeds/rapid-rss.xml`;
}

/**
 * Dynamically constructs the public XML sitemap discovery feed URL.
 */
export function getPublicSitemapUrl(baseUrl?: string): string {
  const base = baseUrl ? validateAppBaseUrl(baseUrl).url : getAppBaseUrl();
  return `${base}/api/feeds/rapid-sitemap.xml`;
}

/**
 * Dynamically constructs the crawlable relay gateway URL for a target URL slug.
 */
export function getRelayGatewayUrl(slug: string, baseUrl?: string): string {
  const base = baseUrl ? validateAppBaseUrl(baseUrl).url : getAppBaseUrl();
  return `${base}/relay/${slug}`;
}
