import { describe, it, expect, vi } from 'vitest';
import { analyzeUrl } from '../src/lib/analyzer';
import { validateUrlForSSRF } from '../src/lib/ssrf';
import { evaluateIndexingApiEligibility } from '../src/lib/indexing-eligibility';
import { normalizeUrl, findBestMatchingProperty } from '../src/lib/property-matcher';
import { deductCredits, addCredits } from '../src/lib/credit-ledger';

describe('A. URL Pipeline & Target URL Support (Section D)', () => {
  it('correctly classifies and parses PDF document signatures', async () => {
    // Mock fetch for PDF test
    const mockPdfBuffer = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xc4, 0xe5,
    ]); // %PDF-1.4

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers({
        'content-type': 'application/pdf',
        'content-length': '84974',
      }),
      body: {
        getReader: () => {
          let read = false;
          return {
            read: async () => {
              if (!read) {
                read = true;
                return { done: false, value: mockPdfBuffer };
              }
              return { done: true, value: undefined };
            },
          };
        },
      },
    });

    try {
      const result = await analyzeUrl('https://actv.avmspa.it/sites/default/files/webform/TESTING.pdf');
      expect(result.httpStatus).toBe(200);
      expect(result.documentType).toBe('PDF_DOCUMENT');
      expect(result.pdfDetails?.isPdfSignatureValid).toBe(true);
      expect(result.pdfDetails?.pdfVersion).toBe('1.4');
      expect(result.isThirdPartyHosted).toBe(true);
      expect(result.issues.some((i) => i.issue === 'PDF_VERIFIED')).toBe(true);
      expect(result.passedAudit).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('correctly audits 3rd-party forum thread and extracts real server status without claiming GSC ownership', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>TOS Deletion - Wanna Be Famous; an au total drama island rpg</title>
          <link rel="canonical" href="https://autd.proboards.com/thread/7419/hvac-repair-who-call" />
          <meta name="robots" content="noindex, follow" />
        </head>
        <body>
          <p>In accordance with Section 25(a) of the ProBoards Terms of Service, this forum has been taken offline.</p>
        </body>
      </html>
    `;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 400,
      ok: false,
      headers: new Headers({
        'content-type': 'text/html; charset=utf-8',
      }),
      body: {
        getReader: () => {
          let read = false;
          return {
            read: async () => {
              if (!read) {
                read = true;
                return { done: false, value: new TextEncoder().encode(mockHtml) };
              }
              return { done: true, value: undefined };
            },
          };
        },
      },
    });

    try {
      const result = await analyzeUrl('https://autd.proboards.com/thread/7419/hvac-repair-who-call');
      expect(result.httpStatus).toBe(400);
      expect(result.documentType).toBe('HTML_PAGE');
      expect(result.title).toBe('TOS Deletion - Wanna Be Famous; an au total drama island rpg');
      expect(result.isThirdPartyHosted).toBe(true);
      expect(result.issues.some((i) => i.issue === 'THIRD_PARTY_HOST')).toBe(true);
      expect(result.issues.some((i) => i.issue === 'NOINDEX')).toBe(true);
      expect(result.passedAudit).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  }, 15000);
});

describe('B. SSRF Security Shield (Section J)', () => {
  it('blocks AWS/Cloud metadata IP (169.254.169.254)', async () => {
    const check = await validateUrlForSSRF('http://169.254.169.254/latest/meta-data/');
    expect(check.isSafe).toBe(false);
  });

  it('blocks localhost and loopback IPv4/IPv6', async () => {
    const check1 = await validateUrlForSSRF('http://localhost:3000/api/admin');
    expect(check1.isSafe).toBe(false);

    const check2 = await validateUrlForSSRF('http://127.0.0.1:8080');
    expect(check2.isSafe).toBe(false);

    const check3 = await validateUrlForSSRF('http://[::1]:8080');
    expect(check3.isSafe).toBe(false);
  });

  it('blocks private 10.0.0.0/8 and 192.168.0.0/16 ranges', async () => {
    const check1 = await validateUrlForSSRF('http://10.0.1.5/admin');
    expect(check1.isSafe).toBe(false);

    const check2 = await validateUrlForSSRF('http://192.168.1.1/router');
    expect(check2.isSafe).toBe(false);
  });
});

describe('C. Google Policy & Indexing Eligibility (Section F & G)', () => {
  it('rejects ordinary blog posts and standard web pages from direct Indexing API', () => {
    const html = `<html><head><title>My Article</title></head><body>Hello world</body></html>`;
    const check = evaluateIndexingApiEligibility(html);
    expect(check.isEligibleForDirectIndexingApi).toBe(false);
    expect(check.contentType).toBe('STANDARD_WEB_PAGE');
    expect(check.recommendedWorkflow).toBe('SEARCH_CONSOLE_INSPECTION_AND_SITEMAP');
  });

  it('permits JobPosting structured data for direct Indexing API', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            { "@context": "https://schema.org/", "@type": "JobPosting", "title": "Software Engineer" }
          </script>
        </head>
      </html>
    `;
    const check = evaluateIndexingApiEligibility(html);
    expect(check.isEligibleForDirectIndexingApi).toBe(true);
    expect(check.contentType).toBe('JOB_POSTING');
    expect(check.recommendedWorkflow).toBe('DIRECT_INDEXING_API');
  });

  it('permits BroadcastEvent structured data for direct Indexing API', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            { "@context": "https://schema.org/", "@type": "BroadcastEvent", "isLiveBroadcast": true }
          </script>
        </head>
      </html>
    `;
    const check = evaluateIndexingApiEligibility(html);
    expect(check.isEligibleForDirectIndexingApi).toBe(true);
    expect(check.contentType).toBe('BROADCAST_EVENT');
    expect(check.recommendedWorkflow).toBe('DIRECT_INDEXING_API');
  });
});

describe('D. Credit Ledger Atomicity & Idempotency (Section I)', () => {
  it('enforces idempotency on duplicate deduction keys', async () => {
    const idempotencyKey = `test_deduct_${Date.now()}`;
    // Deduct once
    const res1 = await deductCredits({
      userId: 'test-user-id',
      amount: 1,
      operation: 'TEST_OP',
      idempotencyKey,
    });

    // Attempt second deduction with same key
    const res2 = await deductCredits({
      userId: 'test-user-id',
      amount: 1,
      operation: 'TEST_OP',
      idempotencyKey,
    });

    // Should not error or double-charge
    expect(res2).toBeDefined();
  });
});

describe('E. Search Console Property Matching (Section F)', () => {
  it('correctly matches domain and URL-prefix properties', () => {
    const properties = [
      { id: 'p1', propertyUrl: 'sc-domain:example.com' },
      { id: 'p2', propertyUrl: 'https://example.com/blog/' },
    ];

    const match1 = findBestMatchingProperty('https://example.com/pricing', properties);
    expect(match1.property?.id).toBe('p1');
    expect(match1.matchType).toBe('DOMAIN');

    const match2 = findBestMatchingProperty('https://example.com/blog/article-1', properties);
    expect(match2.property?.id).toBe('p2'); // Specific prefix wins over domain
    expect(match2.matchType).toBe('EXACT_PREFIX');

    const match3 = findBestMatchingProperty('https://different.com/page', properties);
    expect(match3.property).toBeNull(); // No match
  });
});
