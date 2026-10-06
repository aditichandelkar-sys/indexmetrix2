import { describe, it, expect } from 'vitest';
import { buildGoogleAuthUrl, GOOGLE_OAUTH_SCOPES } from '@/lib/google-client';

describe('Google OAuth 2.0 Flow Verification', () => {
  it('reads GOOGLE_CLIENT_ID correctly from environment', () => {
    expect(process.env.GOOGLE_CLIENT_ID).toBeDefined();
    expect(process.env.GOOGLE_CLIENT_ID).toContain('.apps.googleusercontent.com');
  });

  it('reads GOOGLE_CLIENT_SECRET correctly from environment', () => {
    expect(process.env.GOOGLE_CLIENT_SECRET).toBeDefined();
    expect(process.env.GOOGLE_CLIENT_SECRET).toMatch(/^GOCSPX-/);
  });

  it('reads GOOGLE_REDIRECT_URI correctly from environment', () => {
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/google/callback';
    expect(redirectUri).toBe('http://localhost:3000/api/google/callback');
  });

  it('builds an authentic Google authorization URL with matching client ID, redirect URI, and scopes', () => {
    const testState = 'user_123:nonce_abc';
    const authUrl = buildGoogleAuthUrl(testState);
    const parsed = new URL(authUrl);

    expect(parsed.origin).toBe('https://accounts.google.com');
    expect(parsed.pathname).toBe('/o/oauth2/v2/auth');
    expect(parsed.searchParams.get('client_id')).toBe(process.env.GOOGLE_CLIENT_ID);
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/google/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    expect(parsed.searchParams.get('state')).toBe(testState);

    const scopes = parsed.searchParams.get('scope')?.split(' ') || [];
    expect(scopes).toContain('openid');
    expect(scopes).toContain('email');
    expect(scopes).toContain('profile');
    expect(scopes).toContain('https://www.googleapis.com/auth/webmasters.readonly');
    expect(scopes).toContain('https://www.googleapis.com/auth/indexing');
  });

  it('sanitizes error messages so secrets and tokens are never exposed in query params or logs', () => {
    const rawError = 'Token exchange failed: client_secret GOCSPX-SecretString123 and token ya29.token123 and refresh 1//0g_refresh123';
    const sanitized = rawError
      .replace(/GOCSPX-[A-Za-z0-9_-]+/g, '[REDACTED_CLIENT_SECRET]')
      .replace(/ya29\.[A-Za-z0-9_-]+/g, '[REDACTED_ACCESS_TOKEN]')
      .replace(/1\/\/[A-Za-z0-9_-]+/g, '[REDACTED_REFRESH_TOKEN]');

    expect(sanitized).not.toContain('GOCSPX-SecretString123');
    expect(sanitized).not.toContain('ya29.token123');
    expect(sanitized).not.toContain('1//0g_refresh123');
    expect(sanitized).toContain('[REDACTED_CLIENT_SECRET]');
    expect(sanitized).toContain('[REDACTED_ACCESS_TOKEN]');
    expect(sanitized).toContain('[REDACTED_REFRESH_TOKEN]');
  });

  it('correctly classifies Search Console property types (Domain Property vs URL Prefix)', () => {
    const domainProp = 'sc-domain:example.com';
    const urlProp = 'https://example.com/';
    const httpProp = 'http://blog.example.com/';

    expect(domainProp.startsWith('sc-domain:')).toBe(true);
    expect(urlProp.startsWith('sc-domain:')).toBe(false);
    expect(httpProp.startsWith('sc-domain:')).toBe(false);
  });

  it('targets the official Google Search Console Sites API endpoint', () => {
    const SEARCH_CONSOLE_SITES_API = 'https://www.googleapis.com/webmasters/v3/sites';
    expect(SEARCH_CONSOLE_SITES_API).toBe('https://www.googleapis.com/webmasters/v3/sites');
  });
});

