import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkGoogleIndexStatus,
  areUrlsEquivalent,
  extractSerpResultUrls,
  detectGoogleBlock,
  detectGoogleNoResults,
} from '../src/lib/serp-checker';
import { POST as checkIndexRoute } from '../src/app/api/urls/check-index/route';
import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/db';
import * as auth from '../src/lib/auth';

describe('Google SERP Indexing Verification & Regression Suite', () => {
  // =========================================================================
  // 1. URL EQUIVALENCE & SAFE NORMALIZATION TESTS
  // =========================================================================
  describe('areUrlsEquivalent', () => {
    it('matches exact identical URLs', () => {
      const url = 'https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help';
      expect(areUrlsEquivalent(url, url)).toBe(true);
    });

    it('matches URL with vs without trailing slash', () => {
      const urlA = 'https://example.com/blog/seo-checklist';
      const urlB = 'https://example.com/blog/seo-checklist/';
      expect(areUrlsEquivalent(urlA, urlB)).toBe(true);
    });

    it('matches protocol variation (http vs https)', () => {
      const urlA = 'https://example.com/articles/quick-index';
      const urlB = 'http://example.com/articles/quick-index';
      expect(areUrlsEquivalent(urlA, urlB)).toBe(true);
    });

    it('matches www vs non-www domain variation', () => {
      const urlA = 'https://www.example.com/page';
      const urlB = 'https://example.com/page';
      expect(areUrlsEquivalent(urlA, urlB)).toBe(true);
    });

    it('ignores analytics and tracking query parameters (utm_*, fbclid)', () => {
      const cleanUrl = 'https://example.com/post';
      const trackedUrl = 'https://example.com/post?utm_source=google&utm_medium=serp&fbclid=123';
      expect(areUrlsEquivalent(cleanUrl, trackedUrl)).toBe(true);
    });

    it('REJECTS domain-only match when target is a specific subpath/thread', () => {
      const targetUrl = 'https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help';
      const domainRoot = 'https://gb32.proboards.com/';
      expect(areUrlsEquivalent(targetUrl, domainRoot)).toBe(false);
    });

    it('REJECTS sibling paths or different forum threads on the same domain', () => {
      const targetUrl = 'https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help';
      const siblingUrl = 'https://gb32.proboards.com/thread/1234/ac-maintenance-tips';
      expect(areUrlsEquivalent(targetUrl, siblingUrl)).toBe(false);
    });

    it('REJECTS similar path prefix (e.g. /post vs /post-2024)', () => {
      const targetUrl = 'https://example.com/blog/seo-checklist';
      const similarUrl = 'https://example.com/blog/seo-checklist-2024';
      expect(areUrlsEquivalent(targetUrl, similarUrl)).toBe(false);
    });

    it('REJECTS different subdomains', () => {
      const targetUrl = 'https://gb32.proboards.com/thread/4903';
      const otherSubdomain = 'https://happyalone.proboards.com/thread/4903';
      expect(areUrlsEquivalent(targetUrl, otherSubdomain)).toBe(false);
    });

    it('REJECTS functional query parameter differences (e.g. pagination or id)', () => {
      const page1 = 'https://example.com/shop?cat=5&p=1';
      const page2 = 'https://example.com/shop?cat=5&p=2';
      expect(areUrlsEquivalent(page1, page2)).toBe(false);
    });
  });

  // =========================================================================
  // 2. SERP RESULT EXTRACTION TESTS
  // =========================================================================
  describe('extractSerpResultUrls', () => {
    it('extracts URLs from Google redirect format (/url?q=...)', () => {
      const html = `
        <div class="g">
          <a href="/url?q=https%3A%2F%2Fexceptionalhh.com%2Fwp-content%2Fuploads%2Fdocument.pdf&amp;sa=U&amp;ved=2ahUKEwj">
            <h3>Document Title</h3>
          </a>
        </div>
      `;
      const extracted = extractSerpResultUrls(html);
      expect(extracted).toContain('https://exceptionalhh.com/wp-content/uploads/document.pdf');
    });

    it('extracts direct external anchor hrefs', () => {
      const html = `
        <div class="yuRUbf">
          <a href="https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help">
            <h3>Emergency AC Repair</h3>
          </a>
        </div>
      `;
      const extracted = extractSerpResultUrls(html);
      expect(extracted).toContain('https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help');
    });

    it('DOES NOT extract URLs from search input or textarea elements', () => {
      const html = `
        <form action="/search">
          <input name="q" value="site:https://gb32.proboards.com/thread/4903/emergency-repair" />
          <textarea name="q">site:https://gb32.proboards.com/thread/4903/emergency-repair</textarea>
        </form>
        <p>No results found for site:https://gb32.proboards.com/thread/4903/emergency-repair</p>
      `;
      const extracted = extractSerpResultUrls(html);
      expect(extracted.length).toBe(0);
    });

    it('filters out Google internal navigation and infrastructure domains', () => {
      const html = `
        <a href="https://www.google.com/search?q=test">Search</a>
        <a href="https://accounts.google.com/SignOut">Sign Out</a>
        <a href="https://support.google.com/websearch">Help</a>
        <a href="https://policies.google.com/privacy">Privacy</a>
        <a href="https://webcache.googleusercontent.com/search?q=cache:abc">Cached</a>
        <a href="https://example.com/actual-result">Actual Result</a>
      `;
      const extracted = extractSerpResultUrls(html);
      expect(extracted).toEqual(['https://example.com/actual-result']);
    });
  });

  // =========================================================================
  // 3. EXACT MATCH POSITIVE VERIFICATION
  // =========================================================================
  describe('checkGoogleIndexStatus: Positive Verification', () => {
    it('returns CONFIRMED_INDEXED when exact target URL appears in Google results', async () => {
      const targetUrl = 'https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help';
      const mockHtml = `
        <html>
          <body>
            <div class="g">
              <a href="https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help">
                <h3>Emergency AC Repair Help Thread</h3>
              </a>
            </div>
          </body>
        </html>
      `;

      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => mockHtml,
      });

      const result = await checkGoogleIndexStatus(targetUrl, { customFetch: mockFetch as any });

      expect(result.isIndexed).toBe(true);
      expect(result.verificationState).toBe('CONFIRMED_INDEXED');
      expect(result.statusText).toBe('CONFIRMED_INDEXED');
      expect(result.details).toContain('Confirmed! Exact URL appears in live Google search results');
      expect(result.matchedResultUrl).toBe(targetUrl);
    });

    it('returns CONFIRMED_INDEXED when Google returns redirect wrapper for exact URL', async () => {
      const targetUrl = 'https://exceptionalhh.com/wp-content/uploads/form.pdf';
      const mockHtml = `
        <div class="g">
          <a href="/url?q=https%3A%2F%2Fexceptionalhh.com%2Fwp-content%2Fuploads%2Fform.pdf&amp;sa=U">
            <h3>Uploaded Form</h3>
          </a>
        </div>
      `;

      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => mockHtml,
      });

      const result = await checkGoogleIndexStatus(targetUrl, { customFetch: mockFetch as any });

      expect(result.isIndexed).toBe(true);
      expect(result.verificationState).toBe('CONFIRMED_INDEXED');
    });
  });

  // =========================================================================
  // 4. DOMAIN / SUBSTRING / SIBLING FALSE POSITIVE REGRESSION TESTS
  // (Core bug: UI previously showed CONFIRMED INDEXED when domain was in HTML)
  // =========================================================================
  describe('checkGoogleIndexStatus: False Positive Prevention', () => {
    it('MUST NOT return CONFIRMED_INDEXED when domain appears in search box but 0 results found', async () => {
      const targetUrl = 'https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help';
      // Google search page echoing search term in input box, with 0 matching documents
      const mockHtml = `
        <html>
          <input name="q" value="site:https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help" />
          <div>Your search - <b>site:https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help</b> - did not match any documents.</div>
          <p>Suggestions: Make sure that all words are spelled correctly.</p>
        </html>
      `;

      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => mockHtml,
      });

      const result = await checkGoogleIndexStatus(targetUrl, { customFetch: mockFetch as any });

      expect(result.isIndexed).toBe(false);
      expect(result.verificationState).toBe('NOT_INDEXED');
      expect(result.statusText).toBe('NOT_INDEXED');
      expect(result.details).toContain('Google search returned 0 results for this URL query');
    });

    it('MUST NOT return CONFIRMED_INDEXED when Google returns other pages on the domain', async () => {
      const targetUrl = 'https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help';
      // Google returned home page and thread 1000, but NOT thread 4903
      const mockHtml = `
        <html>
          <input name="q" value="site:https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help" />
          <div class="g">
            <a href="https://gb32.proboards.com/"><h3>GB32 Home Board</h3></a>
          </div>
          <div class="g">
            <a href="https://gb32.proboards.com/thread/1000/welcome-to-forum"><h3>Welcome Thread</h3></a>
          </div>
        </html>
      `;

      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => mockHtml,
      });

      const result = await checkGoogleIndexStatus(targetUrl, { customFetch: mockFetch as any });

      expect(result.isIndexed).toBe(false);
      expect(result.verificationState).toBe('NOT_INDEXED');
      expect(result.details).toContain('none match the exact submitted canonical URL');
    });

    it('MUST NOT return CONFIRMED_INDEXED for similar prefix URL', async () => {
      const targetUrl = 'https://example.com/blog/seo';
      const mockHtml = `
        <div class="g">
          <a href="https://example.com/blog/seo-ultimate-guide-2026"><h3>SEO Ultimate Guide</h3></a>
        </div>
      `;

      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => mockHtml,
      });

      const result = await checkGoogleIndexStatus(targetUrl, { customFetch: mockFetch as any });

      expect(result.isIndexed).toBe(false);
      expect(result.verificationState).toBe('NOT_INDEXED');
    });
  });

  // =========================================================================
  // 5. INCONCLUSIVE / RATE-LIMITED / CAPTCHA / ERROR TESTS
  // =========================================================================
  describe('checkGoogleIndexStatus: Anti-Bot & Error Handling', () => {
    it('returns UNABLE_TO_VERIFY when Google returns HTTP 429 Too Many Requests', async () => {
      const targetUrl = 'https://example.com/test-url';

      const mockFetch = vi.fn().mockResolvedValue({
        status: 429,
        text: async () => '<html><body>429 Too Many Requests</body></html>',
      });

      const result = await checkGoogleIndexStatus(targetUrl, { customFetch: mockFetch as any });

      expect(result.isIndexed).toBe(false);
      expect(result.verificationState).toBe('UNABLE_TO_VERIFY');
      expect(result.statusText).toBe('UNABLE_TO_VERIFY');
      expect(result.details).toContain('HTTP 429 Too Many Requests');
    });

    it('returns UNABLE_TO_VERIFY when Google returns CAPTCHA / unusual traffic challenge', async () => {
      const targetUrl = 'https://gb32.proboards.com/thread/4903/emergency';
      const captchaHtml = `
        <html>
          <form id="captcha-form" action="/sorry/index?continue=https://www.google.com/search%3Fq%3Dsite%253Agb32.proboards.com">
            <div class="g-recaptcha"></div>
            <p>Our systems have detected unusual traffic from your computer network.</p>
          </form>
        </html>
      `;

      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => captchaHtml,
      });

      const result = await checkGoogleIndexStatus(targetUrl, { customFetch: mockFetch as any });

      expect(result.isIndexed).toBe(false);
      expect(result.verificationState).toBe('UNABLE_TO_VERIFY');
      expect(result.details).toContain('CAPTCHA or unusual traffic anti-bot challenge');
    });

    it('returns UNABLE_TO_VERIFY on network timeout or fetch error without fabricating crawl status', async () => {
      const targetUrl = 'https://example.com/test-timeout';

      const mockFetch = vi.fn().mockRejectedValue(new Error('ETIMEDOUT: Connection timed out'));

      const result = await checkGoogleIndexStatus(targetUrl, { customFetch: mockFetch as any });

      expect(result.isIndexed).toBe(false);
      expect(result.verificationState).toBe('UNABLE_TO_VERIFY');
      expect(result.details).toContain('Unable to verify Google SERP status');
      // Must not fabricate that Googlebot was queued or crawl sent
      expect(result.details).not.toContain('Googlebot has been notified to crawl');
    });
  });

  // =========================================================================
  // 6. CHECK-INDEX API ROUTE INTEGRATION
  // =========================================================================
  describe('POST /api/urls/check-index Route', () => {
    let testUser: any;
    let testProject: any;

    beforeEach(async () => {
      testUser = await prisma.user.findFirst({ where: { email: 'customer@indexmatrix.io' } });
      if (!testUser) {
        testUser = await prisma.user.create({
          data: {
            email: 'customer@indexmatrix.io',
            passwordHash: 'dummy',
            name: 'Acme Test Customer',
            role: 'CUSTOMER',
          },
        });
      }

      vi.spyOn(auth, 'getSessionUser').mockResolvedValue(testUser);

      testProject = await prisma.project.upsert({
        where: { id: 'c1b2a3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d' },
        update: {},
        create: {
          id: 'c1b2a3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
          userId: testUser.id,
          name: 'SERP Check Project',
          domain: 'proboards.com',
        },
      });
    });

    it('does not set lastCrawl timestamp and accurately records verificationState in DB', async () => {
      const targetUrl = 'https://gb32.proboards.com/thread/4903/emergency-conditioner-repair-number-help';

      // Ensure DB record exists
      const urlRecord = await prisma.url.upsert({
        where: {
          projectId_normalizedUrl: {
            projectId: testProject.id,
            normalizedUrl: targetUrl,
          },
        },
        update: { status: 'SUBMITTED', lastCrawl: null },
        create: {
          projectId: testProject.id,
          originalUrl: targetUrl,
          normalizedUrl: targetUrl,
          hostname: 'gb32.proboards.com',
          path: '/thread/4903/emergency-conditioner-repair-number-help',
          status: 'SUBMITTED',
        },
      });

      const req = new NextRequest('http://localhost:3000/api/urls/check-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });

      const res = await checkIndexRoute(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.report).toBeDefined();
      expect(data.report.verificationState).toBeDefined();

      // Check database: lastCrawl must NOT have been fabricated
      const updated = await prisma.url.findUnique({ where: { id: urlRecord.id } });
      expect(updated?.lastCrawl).toBeNull();
    });
  });
});
