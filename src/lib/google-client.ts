import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { encryptText, decryptText } from './crypto';
import { prisma } from './db';
import { getAppBaseUrl } from './app-config';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SEARCH_CONSOLE_SITES_API = 'https://www.googleapis.com/webmasters/v3/sites';
const URL_INSPECTION_API = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/webmasters.readonly',
  // Official indexing scope (only used when eligible content is present)
  'https://www.googleapis.com/auth/indexing',
];

/**
 * Strips any sensitive credentials, tokens, or client secrets from error strings
 */
export function sanitizeGoogleError(msg: string): string {
  return msg
    .replace(/GOCSPX-[A-Za-z0-9_-]+/g, '[REDACTED_CLIENT_SECRET]')
    .replace(/ya29\.[A-Za-z0-9_-]+/g, '[REDACTED_ACCESS_TOKEN]')
    .replace(/1\/\/[A-Za-z0-9_-]+/g, '[REDACTED_REFRESH_TOKEN]');
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams | Record<string, any>;
  timeoutMs?: number;
}

export interface SafeFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, any>;
  text: () => Promise<string>;
  json: () => Promise<any>;
}

/**
 * Reliable HTTP client for Google APIs forcing IPv4 DNS resolution.
 * Prevents Windows networking stalls caused by undici dual-stack attempting
 * deprecated RFC 4291 IPv4-compatible IPv6 addresses (::172.x.x.x).
 */
export function safeGoogleFetch(urlStr: string, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const headers: Record<string, string | number> = { ...(options.headers || {}) };
      let bodyData: string | Buffer | undefined;

      if (options.body) {
        if (typeof options.body === 'string' || options.body instanceof Buffer) {
          bodyData = options.body;
        } else if (options.body instanceof URLSearchParams) {
          bodyData = options.body.toString();
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/x-www-form-urlencoded';
        } else if (typeof options.body === 'object') {
          bodyData = JSON.stringify(options.body);
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        }
      }

      if (bodyData) {
        headers['Content-Length'] = Buffer.byteLength(bodyData);
      }

      const reqOptions: https.RequestOptions = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers,
        family: 4, // IPv4 prevents connect timeouts from unroutable IPv6 records on Windows
        timeout: options.timeoutMs || 30000,
      };

      const req = client.request(reqOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
            status: res.statusCode || 500,
            statusText: res.statusMessage || '',
            headers: res.headers as Record<string, any>,
            text: async () => rawBody,
            json: async () => JSON.parse(rawBody),
          });
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Connection to ${parsedUrl.hostname} timed out after 30s`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Resolves the Google OAuth redirect URI with environment-aware validation
 */
export function getGoogleRedirectUri(): string {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  if (process.env.NODE_ENV === 'production') {
    return `${getAppBaseUrl()}/api/google/callback`;
  }
  return 'http://localhost:3000/api/google/callback';
}

/**
 * Builds the Google OAuth 2.0 authorization URL
 */
export function buildGoogleAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const redirectUri = getGoogleRedirectUri();

  if (!clientId || clientId.startsWith('mock-')) {
    throw new Error('Google OAuth client ID is NOT_CONFIGURED. Please configure valid GOOGLE_CLIENT_ID in environment variables.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    access_type: 'offline', // Request refresh token
    prompt: 'consent', // Force consent screen to guarantee refresh token
    state,
  });

  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope: string;
  idToken?: string;
}

/**
 * Exchanges authorization code for access & refresh tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = getGoogleRedirectUri();

  // Do not fake OAuth tokens in production!
  if (!clientId || clientId.startsWith('mock-') || !clientSecret || clientSecret.startsWith('mock-')) {
    throw new Error('Google OAuth credentials are NOT_CONFIGURED. Please configure valid GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in environment variables.');
  }

  const response = await safeGoogleFetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let parsedMessage = errorText;
    try {
      const errJson = JSON.parse(errorText);
      parsedMessage = errJson.error_description || errJson.error?.message || errJson.error || errorText;
    } catch {}
    throw new Error(`Google token exchange failed (${response.status}): ${sanitizeGoogleError(parsedMessage)}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
    idToken: data.id_token,
  };
}

/**
 * Refreshes an expired Google access token
 */
export async function refreshGoogleAccessToken(accountId: string): Promise<string> {
  const account = await prisma.googleAccount.findUnique({
    where: { id: accountId },
  });

  if (!account || !account.encryptedRefreshToken) {
    throw new Error('Google account or refresh token not found');
  }

  const refreshToken = decryptText(account.encryptedRefreshToken);
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  if (!clientId || clientId.startsWith('mock-') || !clientSecret || clientSecret.startsWith('mock-')) {
    throw new Error('Google OAuth credentials are NOT_CONFIGURED. Please configure valid GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in environment variables.');
  }

  const response = await safeGoogleFetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    let parsedMessage = err;
    try {
      const errJson = JSON.parse(err);
      parsedMessage = errJson.error_description || errJson.error?.message || errJson.error || err;
    } catch {}
    await prisma.googleAccount.update({
      where: { id: accountId },
      data: { status: 'EXPIRED' },
    });
    throw new Error(`Google token refresh failed (${response.status}): ${sanitizeGoogleError(parsedMessage)}`);
  }

  const data = await response.json();
  const newAccessToken = data.access_token;
  const newExpiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);

  await prisma.googleAccount.update({
    where: { id: accountId },
    data: {
      encryptedAccessToken: encryptText(newAccessToken),
      tokenExpiresAt: newExpiresAt,
      status: 'ACTIVE',
    },
  });

  return newAccessToken;
}

/**
 * Gets a valid access token for a Google account (auto-refreshing if expired)
 */
export async function getValidAccessToken(accountId: string): Promise<string> {
  const account = await prisma.googleAccount.findUnique({
    where: { id: accountId },
  });

  if (!account) throw new Error('Account not found');

  // If token expires in less than 5 minutes, refresh it
  if (account.tokenExpiresAt.getTime() - Date.now() < 300000) {
    return refreshGoogleAccessToken(accountId);
  }

  return decryptText(account.encryptedAccessToken);
}

export interface SearchConsolePropertyEntry {
  siteUrl: string;
  permissionLevel: string;
}

/**
 * Lists verified Google Search Console properties for an authenticated Google Account
 */
export async function listSearchConsoleProperties(accountId: string): Promise<SearchConsolePropertyEntry[]> {
  const accessToken = await getValidAccessToken(accountId);

  if (accessToken.startsWith('mock_')) {
    throw new Error('CONNECTION_REQUIRED: Live Google account authorization required to retrieve Search Console properties.');
  }

  const res = await safeGoogleFetch(SEARCH_CONSOLE_SITES_API, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    let parsedMessage = errText;
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error?.message) {
        parsedMessage = errJson.error.message;
      } else if (errJson.error_description) {
        parsedMessage = errJson.error_description;
      } else if (errJson.error) {
        parsedMessage = typeof errJson.error === 'string' ? errJson.error : JSON.stringify(errJson.error);
      }
    } catch {}
    throw new Error(`Google Search Console API error (${res.status}): ${sanitizeGoogleError(parsedMessage)}`);
  }

  const data = await res.json();
  const siteEntryList = data.siteEntry || [];

  return siteEntryList.map((entry: any) => ({
    siteUrl: entry.siteUrl,
    permissionLevel: entry.permissionLevel || 'siteRestrictedUser',
  }));
}

export interface URLInspectionResponse {
  inspectionResult: {
    verdict: string;
    coverageState?: string;
    robotsTxtState?: string;
    indexingState?: string;
    pageFetchState?: string;
    googleCanonical?: string;
    userCanonical?: string;
    crawledAs?: string;
    lastCrawlTime?: string;
    referringUrls?: string[];
  };
  inspectionResultLink?: string;
  raw: any;
}

/**
 * Calls the official Google Search Console URL Inspection API
 */
export async function inspectUrlWithGoogle(
  accountId: string,
  inspectionUrl: string,
  siteUrl: string
): Promise<URLInspectionResponse> {
  const accessToken = await getValidAccessToken(accountId);

  if (accessToken.startsWith('mock_')) {
    throw new Error('CONNECTION_REQUIRED: Live Google account authorization required to inspect URLs via official Google URL Inspection API.');
  }

  const res = await safeGoogleFetch(URL_INSPECTION_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inspectionUrl,
      siteUrl,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    let parsedMessage = errText;
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error?.message) {
        parsedMessage = errJson.error.message;
      } else if (errJson.error_description) {
        parsedMessage = errJson.error_description;
      }
    } catch {}
    throw new Error(`Google URL Inspection API error (${res.status}): ${sanitizeGoogleError(parsedMessage)}`);
  }

  const data = await res.json();
  const ir = data.inspectionResult || {};
  const indexStatus = ir.indexStatusResult || {};

  return {
    inspectionResult: {
      verdict: indexStatus.verdict || 'NEUTRAL',
      coverageState: indexStatus.coverageState,
      robotsTxtState: indexStatus.robotsTxtState,
      indexingState: indexStatus.indexingState,
      pageFetchState: indexStatus.pageFetchState,
      googleCanonical: indexStatus.googleCanonical,
      userCanonical: indexStatus.userCanonical,
      crawledAs: indexStatus.crawledAs,
      lastCrawlTime: indexStatus.lastCrawlTime,
      referringUrls: indexStatus.referringUrls || [],
    },
    inspectionResultLink: ir.inspectionResultLink,
    raw: data,
  };
}

/**
 * Normalizes Google coverage verdict into strict UrlStatus.
 * CRITICAL POLICY: "Crawled - currently not indexed" is NEVER marked INDEXED.
 */
export function normalizeGoogleVerdictToStatus(verdict?: string, coverageState?: string): 'INDEXED' | 'NOT_INDEXED' {
  const v = (verdict || '').toUpperCase();
  const c = (coverageState || '').toLowerCase();

  // If coverage explicitly says "not indexed", it is strictly NOT_INDEXED
  if (c.includes('not indexed') || c.includes('excluded') || c.includes('blocked') || c.includes('error')) {
    return 'NOT_INDEXED';
  }

  // Only mark INDEXED if verdict is PASS or coverage explicitly says "submitted and indexed" / "indexed, not in sitemap"
  if (v === 'PASS' || c.includes('submitted and indexed') || c.includes('indexed, not in sitemap') || (c.includes('indexed') && !c.includes('not indexed'))) {
    return 'INDEXED';
  }

  return 'NOT_INDEXED';
}
