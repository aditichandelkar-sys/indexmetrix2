import { describe, it, expect } from 'vitest';
import sitemap from '@/app/sitemap';
import robots from '@/app/robots';

describe('Production Sitemap & Robots Configuration', () => {
  it('generates a valid sitemap containing canonical indexmetrix.com URLs', () => {
    const items = sitemap();

    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(10);

    const urls = items.map((i) => i.url);

    // Verify all URLs are absolute HTTPS URLs pointing to indexmetrix.com
    for (const url of urls) {
      expect(url.startsWith('https://indexmetrix.com')).toBe(true);
      expect(() => new URL(url)).not.toThrow();
      const parsed = new URL(url);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.hostname).toBe('indexmetrix.com');
      // No 3rd-party domains
      expect(parsed.hostname).not.toContain('v1.');
      expect(parsed.hostname).not.toContain('proboards');
      expect(parsed.hostname).not.toContain('exceptionalhh');
    }

    // Verify all core canonical pages exist in the sitemap
    const expectedPaths = [
      'https://indexmetrix.com',
      'https://indexmetrix.com/features',
      'https://indexmetrix.com/pricing',
      'https://indexmetrix.com/how-it-works',
      'https://indexmetrix.com/docs',
      'https://indexmetrix.com/faq',
      'https://indexmetrix.com/contact',
      'https://indexmetrix.com/privacy',
      'https://indexmetrix.com/terms',
      'https://indexmetrix.com/refund',
      'https://indexmetrix.com/login',
      'https://indexmetrix.com/register',
    ];

    for (const expected of expectedPaths) {
      expect(urls).toContain(expected);
    }

    // Ensure valid priorities and change frequencies
    for (const item of items) {
      expect(item.priority).toBeDefined();
      expect(item.priority).toBeGreaterThanOrEqual(0.1);
      expect(item.priority).toBeLessThanOrEqual(1.0);
      expect(item.changeFrequency).toBeDefined();
      expect(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']).toContain(
        item.changeFrequency
      );
      expect(item.lastModified).toBeInstanceOf(Date);
    }
  });

  it('generates robots.txt referencing the canonical production sitemap', () => {
    const config = robots();

    expect(config).toBeDefined();
    expect(config.sitemap).toBe('https://indexmetrix.com/sitemap.xml');

    const rules = Array.isArray(config.rules) ? config.rules : [config.rules];
    expect(rules.length).toBeGreaterThan(0);

    const defaultRule = rules[0];
    expect(defaultRule.userAgent).toBe('*');
    expect(defaultRule.allow).toBe('/');

    // Ensure private/dashboard paths are disallowed from crawling
    const disallow = Array.isArray(defaultRule.disallow)
      ? defaultRule.disallow
      : [defaultRule.disallow];
    expect(disallow).toContain('/api/');
    expect(disallow).toContain('/dashboard/');
    expect(disallow).toContain('/admin/');
  });
});
