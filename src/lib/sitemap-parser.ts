import * as cheerio from 'cheerio';
import { validateUrlForSSRF } from './ssrf';

export interface ParsedSitemapResult {
  isIndex: boolean;
  urls: string[];
  subSitemaps: string[];
  totalExtracted: number;
  error?: string;
}

export interface ParsedFeedResult {
  title: string;
  urls: string[];
  totalExtracted: number;
  error?: string;
}

const MAX_SITEMAP_URLS = 5000;
const MAX_SITEMAP_DEPTH = 3;

/**
 * Fetches and parses an XML sitemap or sitemap index with SSRF protection
 */
export async function parseSitemap(
  sitemapUrl: string,
  currentDepth: number = 0,
  visitedUrls: Set<string> = new Set()
): Promise<ParsedSitemapResult> {
  if (currentDepth > MAX_SITEMAP_DEPTH) {
    return {
      isIndex: false,
      urls: [],
      subSitemaps: [],
      totalExtracted: 0,
      error: `Maximum sitemap recursion depth (${MAX_SITEMAP_DEPTH}) exceeded`,
    };
  }

  const ssrf = await validateUrlForSSRF(sitemapUrl);
  if (!ssrf.isSafe) {
    return {
      isIndex: false,
      urls: [],
      subSitemaps: [],
      totalExtracted: 0,
      error: `SSRF Block: ${ssrf.reason}`,
    };
  }

  try {
    const res = await fetch(sitemapUrl, {
      headers: {
        'User-Agent': 'IndexMatrixBot/1.0 (+https://indexmatrix.io/sitemap-bot)',
        Accept: 'application/xml,text/xml,*/*',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return {
        isIndex: false,
        urls: [],
        subSitemaps: [],
        totalExtracted: 0,
        error: `HTTP ${res.status}: Failed to retrieve sitemap`,
      };
    }

    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    // 1. Check if Sitemap Index
    const sitemapTags = $('sitemapindex > sitemap > loc');
    if (sitemapTags.length > 0) {
      const subSitemaps: string[] = [];
      sitemapTags.each((_, el) => {
        const loc = $(el).text().trim();
        if (loc && /^https?:\/\//i.test(loc)) {
          subSitemaps.push(loc);
        }
      });

      // Safely recurse through child sitemaps if within limits
      const collectedUrls = new Set<string>();
      visitedUrls.add(sitemapUrl);

      for (const subUrl of subSitemaps) {
        if (collectedUrls.size >= MAX_SITEMAP_URLS) break;
        if (visitedUrls.has(subUrl)) continue;
        visitedUrls.add(subUrl);

        try {
          const subResult = await parseSitemap(subUrl, currentDepth + 1, visitedUrls);
          for (const u of subResult.urls) {
            collectedUrls.add(u);
            if (collectedUrls.size >= MAX_SITEMAP_URLS) break;
          }
        } catch {
          // Continue to next child sitemap if one fails
        }
      }

      return {
        isIndex: true,
        urls: Array.from(collectedUrls),
        subSitemaps,
        totalExtracted: collectedUrls.size,
      };
    }

    // 2. Standard URL Set
    const urlLocs = $('urlset > url > loc');
    const urlSet = new Set<string>();

    urlLocs.each((_, el) => {
      if (urlSet.size >= MAX_SITEMAP_URLS) return false;
      const loc = $(el).text().trim();
      if (loc && /^https?:\/\//i.test(loc)) {
        urlSet.add(loc);
      }
    });

    const urls = Array.from(urlSet);
    return {
      isIndex: false,
      urls,
      subSitemaps: [],
      totalExtracted: urls.length,
    };
  } catch (err: any) {
    return {
      isIndex: false,
      urls: [],
      subSitemaps: [],
      totalExtracted: 0,
      error: err.message || 'Error parsing sitemap XML',
    };
  }
}

/**
 * Fetches and parses an RSS or Atom feed to extract discovered URLs
 */
export async function parseFeed(feedUrl: string): Promise<ParsedFeedResult> {
  const ssrf = await validateUrlForSSRF(feedUrl);
  if (!ssrf.isSafe) {
    return {
      title: '',
      urls: [],
      totalExtracted: 0,
      error: `SSRF Block: ${ssrf.reason}`,
    };
  }

  try {
    const res = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'IndexMatrixBot/1.0 (+https://indexmatrix.io/feed-bot)',
        Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return {
        title: '',
        urls: [],
        totalExtracted: 0,
        error: `HTTP ${res.status}: Failed to retrieve feed`,
      };
    }

    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    const feedTitle = $('channel > title, feed > title').first().text().trim() || 'Feed';
    const urls = new Set<string>();

    // RSS 2.0 / 0.9 / 1.0 items
    $('item').each((_, el) => {
      if (urls.size >= MAX_SITEMAP_URLS) return false;
      const link = $(el).find('link').text().trim();
      if (link && /^https?:\/\//i.test(link)) {
        urls.add(link);
      } else {
        const guid = $(el).find('guid').text().trim();
        if (guid && /^https?:\/\//i.test(guid)) {
          urls.add(guid);
        }
      }
    });

    // Atom entries
    $('entry').each((_, el) => {
      if (urls.size >= MAX_SITEMAP_URLS) return false;
      let link = $(el).find('link[rel="alternate"]').attr('href') || $(el).find('link:not([rel])').attr('href') || $(el).find('link').attr('href');
      if (!link) {
        link = $(el).find('id').text().trim();
      }
      if (link && /^https?:\/\//i.test(link)) {
        urls.add(link);
      }
    });

    return {
      title: feedTitle,
      urls: Array.from(urls),
      totalExtracted: urls.size,
    };
  } catch (err: any) {
    return {
      title: '',
      urls: [],
      totalExtracted: 0,
      error: err.message || 'Error parsing RSS/Atom feed',
    };
  }
}
