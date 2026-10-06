import * as cheerio from 'cheerio';
import { validateUrlForSSRF } from './ssrf';
import { evaluateIndexingApiEligibility } from './indexing-eligibility';

export interface AuditIssue {
  issue:
    | 'INVALID_URL'
    | 'HTTP_ERROR'
    | 'REDIRECT'
    | 'UNAVAILABLE'
    | 'NON_HTML'
    | 'NOINDEX'
    | 'ROBOTS_BLOCKED'
    | 'CANONICAL_MISMATCH'
    | 'HTTPS_PROBLEM'
    | 'TIMEOUT'
    | 'PDF_VERIFIED'
    | 'THIRD_PARTY_HOST'
    | 'INFO';
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  explanation: string;
  recommendedFix: string;
}

export interface RedirectHop {
  url: string;
  statusCode: number;
}

export interface AnalysisResult {
  url: string;
  finalUrl: string;
  normalizedUrl: string;
  httpStatus: number;
  responseTimeMs: number;
  contentType: string;
  documentType: 'HTML_PAGE' | 'PDF_DOCUMENT' | 'UNSUPPORTED_BINARY';
  isThirdPartyHosted: boolean;
  reachable: boolean;
  robotsAllowed: boolean;
  noindex: boolean;
  canonical: string | null;
  canonicalMatches: boolean;
  title: string | null;
  wordCount: number;
  hasSitemap: boolean;
  sitemapUrls: string[];
  redirectChain: RedirectHop[];
  crawlable: boolean;
  discoveryEligible: boolean;
  warnings: string[];
  pdfDetails?: {
    isPdfSignatureValid: boolean;
    pdfVersion?: string;
    byteSize: number;
  };
  metaDescription: string | null;
  robotsMeta: string | null;
  xRobotsTag: string | null;
  canonicalUrl: string | null;
  robotsTxtStatus: 'ALLOWED' | 'DISALLOWED' | 'NOT_FOUND' | 'ERROR';
  issues: AuditIssue[];
  passedAudit: boolean;
  hasStructuredJob: boolean;
  analyzedAt: string;
}

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10000;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB safe limit for documents and pages

/**
 * Checks if a hostname represents an external 3rd-party platform
 */
function checkThirdPartyHost(hostname: string): { isThirdParty: boolean; platformName?: string } {
  const lower = hostname.toLowerCase();
  if (lower.includes('proboards.com') || lower.includes('boards.net')) {
    return { isThirdParty: true, platformName: 'ProBoards Community Forum' };
  }
  if (lower.includes('wordpress.com') || lower.includes('wp.com')) {
    return { isThirdParty: true, platformName: 'WordPress.com Hosted' };
  }
  if (lower.includes('blogspot.com')) {
    return { isThirdParty: true, platformName: 'Blogger / Blogspot' };
  }
  if (lower.includes('medium.com')) {
    return { isThirdParty: true, platformName: 'Medium Publication' };
  }
  if (lower.includes('github.io')) {
    return { isThirdParty: true, platformName: 'GitHub Pages' };
  }
  if (lower.includes('avmspa.it')) {
    return { isThirdParty: true, platformName: 'AVM S.p.A. Public Portal' };
  }
  return { isThirdParty: false };
}

/**
 * Executes a deep, SSRF-hardened technical SEO audit on a URL (HTML or PDF)
 */
export async function analyzeUrl(targetUrl: string): Promise<AnalysisResult> {
  const issues: AuditIssue[] = [];
  const redirectChain: RedirectHop[] = [];
  const startTime = Date.now();

  let currentUrl = targetUrl;
  let finalResponse: Response | null = null;
  let rawBuffer: Uint8Array = new Uint8Array(0);
  let responseBody = '';
  let contentType = '';

  // 1. Initial SSRF check on target
  const initialSsrf = await validateUrlForSSRF(currentUrl);
  if (!initialSsrf.isSafe) {
    return {
      url: targetUrl,
      finalUrl: targetUrl,
      normalizedUrl: targetUrl,
      httpStatus: 0,
      responseTimeMs: Date.now() - startTime,
      contentType: 'none',
      documentType: 'UNSUPPORTED_BINARY',
      isThirdPartyHosted: false,
      reachable: false,
      robotsAllowed: false,
      noindex: false,
      canonical: null,
      canonicalMatches: true,
      title: null,
      wordCount: 0,
      hasSitemap: false,
      sitemapUrls: [],
      metaDescription: null,
      robotsMeta: null,
      xRobotsTag: null,
      canonicalUrl: null,
      robotsTxtStatus: 'ERROR',
      redirectChain: [],
      crawlable: false,
      discoveryEligible: false,
      warnings: [initialSsrf.reason || 'Target URL rejected by SSRF firewall.'],
      issues: [
        {
          issue: 'INVALID_URL',
          severity: 'CRITICAL',
          explanation: `SSRF Security Block: ${initialSsrf.reason || 'Target URL rejected by SSRF firewall.'}`,
          recommendedFix: 'Specify a publicly accessible HTTP/HTTPS URL on a public domain.',
        },
      ],
      passedAudit: false,
      hasStructuredJob: false,
      analyzedAt: new Date().toISOString(),
    };
  }

  // Check for HTTPS
  if (!currentUrl.startsWith('https://')) {
    issues.push({
      issue: 'HTTPS_PROBLEM',
      severity: 'WARNING',
      explanation: 'The initial URL is served over unencrypted HTTP.',
      recommendedFix: 'Enforce HTTPS with an SSL/TLS certificate and 301 permanent redirect.',
    });
  }

  // Check 3rd-party hosting
  const parsedTarget = new URL(currentUrl);
  const thirdParty = checkThirdPartyHost(parsedTarget.hostname);
  if (thirdParty.isThirdParty) {
    issues.push({
      issue: 'THIRD_PARTY_HOST',
      severity: 'INFO',
      explanation: `This URL is hosted by a third-party service (${thirdParty.platformName || parsedTarget.hostname}). Google Search Console domain ownership cannot be claimed directly on third-party properties.`,
      recommendedFix: 'To track indexing for third-party hosted content, monitor public Google SERP presence or use discovery links.',
    });
  }

  // 2. Fetch loop with SSRF-safe redirect following
  let hops = 0;
  while (hops < MAX_REDIRECTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 IndexMatrixBot/1.0',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'manual', // Manually handle redirects to inspect and validate each hop
        signal: controller.signal,
      });

      clearTimeout(timeout);
      redirectChain.push({ url: currentUrl, statusCode: res.status });

      // Handle Redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        if (!location) {
          issues.push({
            issue: 'REDIRECT',
            severity: 'WARNING',
            explanation: `Received HTTP ${res.status} redirect without a Location header.`,
            recommendedFix: 'Ensure server provides a valid Location header on redirect.',
          });
          finalResponse = res;
          break;
        }

        // Resolve relative redirects
        const nextUrl = new URL(location, currentUrl).toString();

        // Re-validate next hop against SSRF firewall!
        const hopSsrf = await validateUrlForSSRF(nextUrl);
        if (!hopSsrf.isSafe) {
          issues.push({
            issue: 'INVALID_URL',
            severity: 'CRITICAL',
            explanation: `Redirect destination (${nextUrl}) blocked by SSRF firewall: ${hopSsrf.reason}`,
            recommendedFix: 'Ensure server does not redirect to internal or private addresses.',
          });
          finalResponse = res;
          break;
        }

        currentUrl = nextUrl;
        hops++;
        continue;
      }

      // Final response reached
      finalResponse = res;
      contentType = res.headers.get('content-type') || '';

      // Read response body safely up to MAX_BYTES (5MB)
      const reader = res.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.length;
            if (totalBytes > MAX_BYTES) {
              issues.push({
                issue: 'UNAVAILABLE',
                severity: 'WARNING',
                explanation: `Page size exceeded ${MAX_BYTES / 1024 / 1024}MB limit; body was truncated for parsing.`,
                recommendedFix: 'Optimize file size and compress heavy assets.',
              });
              break;
            }
            chunks.push(value);
          }
        }
        const concatenated = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          concatenated.set(chunk, offset);
          offset += chunk.length;
        }
        rawBuffer = concatenated;
        responseBody = new TextDecoder('utf-8', { fatal: false }).decode(concatenated);
      }
      break;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        issues.push({
          issue: 'TIMEOUT',
          severity: 'CRITICAL',
          explanation: `Request timed out after ${TIMEOUT_MS / 1000} seconds.`,
          recommendedFix: 'Check server responsiveness and reduce slow render delays.',
        });
      } else {
        issues.push({
          issue: 'UNAVAILABLE',
          severity: 'CRITICAL',
          explanation: `Network connection failed: ${err.message || 'Unknown network error'}`,
          recommendedFix: 'Verify the website is live, DNS is propagating, and firewalls allow inbound requests.',
        });
      }
      break;
    }
  }

  const responseTimeMs = Date.now() - startTime;
  const httpStatus = finalResponse ? finalResponse.status : 0;

  if (redirectChain.length > 1) {
    issues.push({
      issue: 'REDIRECT',
      severity: 'INFO',
      explanation: `URL redirected through ${redirectChain.length - 1} intermediate hop(s).`,
      recommendedFix: 'Update internal links directly to the final destination to preserve crawl budget.',
    });
  }

  if (httpStatus >= 400) {
    issues.push({
      issue: 'HTTP_ERROR',
      severity: 'CRITICAL',
      explanation: `Server returned HTTP client/server response code ${httpStatus}.`,
      recommendedFix: 'Fix broken links, handle server exceptions, or configure proper status headers.',
    });
  }

  // 3. Inspect headers
  const xRobotsTag = finalResponse?.headers.get('x-robots-tag') || null;
  if (xRobotsTag && /noindex/i.test(xRobotsTag)) {
    issues.push({
      issue: 'NOINDEX',
      severity: 'CRITICAL',
      explanation: `X-Robots-Tag header specifies "${xRobotsTag}", blocking search engine indexing.`,
      recommendedFix: 'Remove "noindex" from X-Robots-Tag HTTP header if this document should be indexed.',
    });
  }

  // 4. Resource / Document Classification
  let documentType: 'HTML_PAGE' | 'PDF_DOCUMENT' | 'UNSUPPORTED_BINARY' = 'HTML_PAGE';
  let pdfDetails: AnalysisResult['pdfDetails'] = undefined;
  let title: string | null = null;
  let metaDescription: string | null = null;
  let robotsMeta: string | null = null;
  let canonicalUrl: string | null = null;
  let hasStructuredJob = false;

  // Check if response is a PDF
  const isPdfContentType =
    contentType.toLowerCase().includes('application/pdf') ||
    contentType.toLowerCase().includes('application/x-pdf');
  const hasPdfExtension = currentUrl.toLowerCase().split('?')[0].endsWith('.pdf');
  const isPdfMagic =
    rawBuffer.length >= 5 &&
    rawBuffer[0] === 0x25 && // %
    rawBuffer[1] === 0x50 && // P
    rawBuffer[2] === 0x44 && // D
    rawBuffer[3] === 0x46 && // F
    rawBuffer[4] === 0x2d; // -

  if (isPdfContentType || isPdfMagic || hasPdfExtension) {
    documentType = 'PDF_DOCUMENT';
    let pdfVersion = 'Unknown';
    if (isPdfMagic) {
      const headerStr = new TextDecoder('ascii').decode(rawBuffer.slice(0, 12));
      const vMatch = headerStr.match(/%PDF-([0-9.]+)/);
      if (vMatch) pdfVersion = vMatch[1];
    }

    pdfDetails = {
      isPdfSignatureValid: isPdfMagic,
      pdfVersion,
      byteSize: rawBuffer.length,
    };

    // Extract PDF title from filename or URL
    const urlParts = currentUrl.split('?')[0].split('/');
    const filename = decodeURIComponent(urlParts[urlParts.length - 1] || 'Document.pdf');
    title = filename;

    if (isPdfMagic) {
      issues.push({
        issue: 'PDF_VERIFIED',
        severity: 'INFO',
        explanation: `Valid PDF Document verified (Signature: %PDF-${pdfVersion}, Size: ${(rawBuffer.length / 1024).toFixed(1)} KB). Googlebot can crawl and extract text from publicly accessible PDFs.`,
        recommendedFix: 'Ensure PDF contains readable text rather than scanned images without OCR.',
      });
    } else {
      issues.push({
        issue: 'UNAVAILABLE',
        severity: 'WARNING',
        explanation: 'Resource declared as PDF but does not begin with standard %PDF- file signature.',
        recommendedFix: 'Verify PDF binary integrity and web server mime-type configuration.',
      });
    }
  } else if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    documentType = 'UNSUPPORTED_BINARY';
    issues.push({
      issue: 'NON_HTML',
      severity: 'WARNING',
      explanation: `Resource served with Content-Type "${contentType}" rather than standard HTML or PDF.`,
      recommendedFix: 'Ensure web pages serve standard text/html or application/pdf content-type.',
    });
  }

  let wordCount = 0;
  const sitemapUrls: string[] = [];

  if (documentType === 'HTML_PAGE' && responseBody) {
    try {
      const $ = cheerio.load(responseBody);

      title = $('title').first().text().trim() || null;
      metaDescription = $('meta[name="description" i]').attr('content')?.trim() || null;
      robotsMeta = $('meta[name="robots" i]').attr('content')?.trim() || null;
      canonicalUrl = $('link[rel="canonical" i]').attr('href')?.trim() || null;

      const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
      wordCount = bodyText ? bodyText.split(' ').filter(Boolean).length : 0;

      // Meta robots validation
      if (robotsMeta && /noindex/i.test(robotsMeta)) {
        issues.push({
          issue: 'NOINDEX',
          severity: 'CRITICAL',
          explanation: `<meta name="robots" content="${robotsMeta}"> is instructing crawlers not to index this page.`,
          recommendedFix: 'Remove the "noindex" directive from the robots meta tag.',
        });
      }

      // Canonical check
      if (canonicalUrl) {
        try {
          const canonicalParsed = new URL(canonicalUrl, currentUrl);
          const currentParsed = new URL(currentUrl);
          if (
            canonicalParsed.hostname !== currentParsed.hostname ||
            canonicalParsed.pathname !== currentParsed.pathname
          ) {
            issues.push({
              issue: 'CANONICAL_MISMATCH',
              severity: 'WARNING',
              explanation: `Canonical URL points to a different target: "${canonicalUrl}".`,
              recommendedFix:
                'Verify whether this page is intended to be canonical, or if search engines should index the canonical target instead.',
            });
          }
        } catch {
          // malformed canonical
        }
      }

      // Title & description checks
      if (!title && httpStatus === 200) {
        issues.push({
          issue: 'UNAVAILABLE',
          severity: 'WARNING',
          explanation: 'The page is missing an HTML <title> tag.',
          recommendedFix: 'Add a concise, descriptive <title> tag (50-60 characters) to improve indexing relevance.',
        });
      }

      // Check JobPosting / BroadcastEvent structured data
      const eligibility = evaluateIndexingApiEligibility(responseBody);
      hasStructuredJob = eligibility.isEligibleForDirectIndexingApi;
    } catch (e: any) {
      issues.push({
        issue: 'NON_HTML',
        severity: 'WARNING',
        explanation: 'Failed to parse page HTML structure: ' + e.message,
        recommendedFix: 'Check for malformed HTML or unclosed tags.',
      });
    }
  }

  // 5. Test robots.txt accessibility & sitemap declaration
  let robotsTxtStatus: 'ALLOWED' | 'DISALLOWED' | 'NOT_FOUND' | 'ERROR' = 'ALLOWED';
  try {
    const urlObj = new URL(currentUrl);
    const robotsTxtUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
    const rSsrf = await validateUrlForSSRF(robotsTxtUrl);
    if (rSsrf.isSafe) {
      const robotsRes = await fetch(robotsTxtUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 IndexMatrixBot/1.0' },
        signal: AbortSignal.timeout(4000),
      }).catch(() => null);

      if (robotsRes && robotsRes.ok) {
        const text = await robotsRes.text();
        if (/User-agent:\s*\*\s*[\r\n]+Disallow:\s*\/\s*($|[\r\n])/i.test(text)) {
          robotsTxtStatus = 'DISALLOWED';
          issues.push({
            issue: 'ROBOTS_BLOCKED',
            severity: 'CRITICAL',
            explanation: 'Website robots.txt disallows all crawling under "User-agent: * Disallow: /".',
            recommendedFix: 'Update /robots.txt to allow search crawlers (Googlebot, etc.) to access indexable pages.',
          });
        }

        // Parse Sitemap declarations from robots.txt
        const smMatches = text.matchAll(/Sitemap:\s*(https?:\/\/[^\s\r\n]+)/gi);
        for (const sm of smMatches) {
          if (sm[1] && !sitemapUrls.includes(sm[1].trim())) {
            sitemapUrls.push(sm[1].trim());
          }
        }
      } else if (robotsRes && robotsRes.status === 404) {
        robotsTxtStatus = 'NOT_FOUND';
      }
    }
  } catch {
    // Non-blocking
  }

  const passedAudit = issues.filter((i) => i.severity === 'CRITICAL').length === 0 && httpStatus === 200;

  const reachable = httpStatus > 0 && httpStatus < 500;
  const robotsAllowed = robotsTxtStatus !== 'DISALLOWED';
  const noindex = Boolean((robotsMeta && /noindex/i.test(robotsMeta)) || (xRobotsTag && /noindex/i.test(xRobotsTag)));

  let canonicalMatches = true;
  if (canonicalUrl) {
    try {
      const cParsed = new URL(canonicalUrl, currentUrl);
      const curParsed = new URL(currentUrl);
      canonicalMatches =
        cParsed.origin === curParsed.origin &&
        cParsed.pathname.replace(/\/$/, '') === curParsed.pathname.replace(/\/$/, '');
    } catch {
      canonicalMatches = false;
    }
  }

  const crawlable = reachable && robotsAllowed && httpStatus < 400;
  const discoveryEligible = crawlable && !noindex && httpStatus === 200;
  const warnings = issues.map((i) => i.explanation);

  return {
    url: targetUrl,
    finalUrl: currentUrl,
    normalizedUrl: currentUrl,
    httpStatus,
    responseTimeMs,
    contentType,
    documentType,
    isThirdPartyHosted: thirdParty.isThirdParty,
    reachable,
    robotsAllowed,
    noindex,
    canonical: canonicalUrl,
    canonicalMatches,
    title,
    wordCount,
    hasSitemap: sitemapUrls.length > 0,
    sitemapUrls,
    redirectChain,
    crawlable,
    discoveryEligible,
    warnings,
    pdfDetails,
    metaDescription,
    robotsMeta,
    xRobotsTag,
    canonicalUrl,
    robotsTxtStatus,
    issues,
    passedAudit,
    hasStructuredJob,
    analyzedAt: new Date().toISOString(),
  };
}
