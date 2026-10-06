import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateAppBaseUrl,
  getAppBaseUrl,
  getPublicFeedUrl,
  getPublicSitemapUrl,
  getRelayGatewayUrl,
} from '../src/lib/app-config';
import { GoogleWebSubProvider } from '../src/lib/discovery/providers/GoogleWebSubProvider';

describe('Application Configuration & Production Readiness Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('1. Development Environment Validation', () => {
    it('allows http://localhost:3000 in development environment', () => {
      const result = validateAppBaseUrl('http://localhost:3000', { nodeEnv: 'development' });
      expect(result.valid).toBe(true);
      expect(result.url).toBe('http://localhost:3000');
      expect(result.isProduction).toBe(false);
    });

    it('defaults to http://localhost:3000 in development if unset', () => {
      delete process.env.APP_BASE_URL;
      delete process.env.NEXT_PUBLIC_APP_URL;
      delete process.env.APP_URL;

      const result = validateAppBaseUrl(undefined, { nodeEnv: 'development' });
      expect(result.valid).toBe(true);
      expect(result.url).toBe('http://localhost:3000');
    });

    it('allows custom local ports in development (e.g. port 3001)', () => {
      const result = validateAppBaseUrl('http://localhost:3001', { nodeEnv: 'development' });
      expect(result.valid).toBe(true);
      expect(result.url).toBe('http://localhost:3001');
    });
  });

  describe('2. Production Environment Strict Security Constraints', () => {
    it('fails clearly in production if APP_BASE_URL is missing', () => {
      const result = validateAppBaseUrl('', { nodeEnv: 'production' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('APP_BASE_URL environment variable is required in production');
    });

    it('fails clearly in production if APP_BASE_URL uses insecure HTTP instead of HTTPS', () => {
      const result = validateAppBaseUrl('http://www.indexmetrix.com', { nodeEnv: 'production' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must use the HTTPS protocol in production');
    });

    it('fails clearly in production if APP_BASE_URL points to localhost', () => {
      const result = validateAppBaseUrl('https://localhost:3000', { nodeEnv: 'production' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot point to localhost or private/loopback IP');
    });

    it('fails clearly in production if APP_BASE_URL points to 127.0.0.1', () => {
      const result = validateAppBaseUrl('https://127.0.0.1:3000', { nodeEnv: 'production' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot point to localhost or private/loopback IP');
    });

    it('fails clearly in production if APP_BASE_URL points to private IP ranges', () => {
      const privateIps = [
        'https://10.0.0.1',
        'https://192.168.1.50',
        'https://172.16.0.1',
        'https://169.254.169.254',
      ];

      for (const ip of privateIps) {
        const res = validateAppBaseUrl(ip, { nodeEnv: 'production' });
        expect(res.valid).toBe(false);
        expect(res.error).toContain('cannot point to localhost or private/loopback IP');
      }
    });

    it('accepts real public HTTPS domain in production and normalizes trailing slashes', () => {
      const result = validateAppBaseUrl('https://www.indexmetrix.com/', { nodeEnv: 'production' });
      expect(result.valid).toBe(true);
      expect(result.url).toBe('https://www.indexmetrix.com');
      expect(result.isProduction).toBe(true);
    });
  });

  describe('3. Dynamic Public Discovery Feed Construction', () => {
    it('constructs dynamic RSS feed URL from configured base URL', () => {
      (process.env as any).NODE_ENV = 'development';
      process.env.APP_BASE_URL = 'http://localhost:3000';

      const feedUrl = getPublicFeedUrl();
      expect(feedUrl).toBe('http://localhost:3000/api/feeds/rapid-rss.xml');
    });

    it('constructs dynamic production HTTPS feed URL', () => {
      (process.env as any).NODE_ENV = 'production';
      process.env.APP_BASE_URL = 'https://www.indexmetrix.com';

      const feedUrl = getPublicFeedUrl();
      expect(feedUrl).toBe('https://www.indexmetrix.com/api/feeds/rapid-rss.xml');
      expect(feedUrl.startsWith('https://')).toBe(true);
      expect(feedUrl).not.toContain('localhost');
    });

    it('constructs dynamic sitemap and relay URLs', () => {
      (process.env as any).NODE_ENV = 'development';
      process.env.APP_BASE_URL = 'http://localhost:3000';

      expect(getPublicSitemapUrl()).toBe('http://localhost:3000/api/feeds/rapid-sitemap.xml');
      expect(getRelayGatewayUrl('test-slug')).toBe('http://localhost:3000/relay/test-slug');
    });
  });

  describe('4. WebSub Provider Dynamic Production Behavior', () => {
    it('publishes configured public HTTPS feed URL in production WebSub payload', async () => {
      (process.env as any).NODE_ENV = 'production';
      process.env.APP_BASE_URL = 'https://www.indexmetrix.com';

      let interceptedBody: string = '';
      global.fetch = vi.fn().mockImplementation((url, init) => {
        interceptedBody = (init?.body as string) || '';
        return Promise.resolve({
          status: 204,
          text: async () => '',
        } as any);
      });

      const provider = new GoogleWebSubProvider();
      const record = await provider.submit('https://happyalone.proboards.com/thread/44393/ac-stopped-working-repair-services');

      expect(record.accepted).toBe(true);
      expect(record.requestStatus).toBe('SUCCESS');
      expect(record.httpStatus).toBe(204);

      // Verify outbound payload contains public HTTPS URL and NEVER localhost
      expect(interceptedBody).toContain('hub.url=https%3A%2F%2Fwww.indexmetrix.com%2Fapi%2Ffeeds%2Frapid-rss.xml');
      expect(interceptedBody).not.toContain('localhost');
      expect(interceptedBody).not.toContain('http%3A%2F%2Flocalhost');
    });

    it('safely catches invalid production configuration and returns FAILED without making live request', async () => {
      (process.env as any).NODE_ENV = 'production';
      process.env.APP_BASE_URL = 'https://localhost:3000'; // Prohibited localhost in production!

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const provider = new GoogleWebSubProvider();
      const record = await provider.submit('https://example.com/test');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(record.accepted).toBe(false);
      expect(record.requestStatus).toBe('FAILED');
      expect(record.errorCode).toBe('INVALID_APP_BASE_URL');
      expect(record.errorMessage).toContain('cannot point to localhost');
    });
  });
});
