import { DiscoveryAdapter, DiscoveryContext, DiscoveryResult } from '../types';
import { parseSitemap } from '../../sitemap-parser';

export class SitemapAdapter implements DiscoveryAdapter {
  name = 'SitemapAdapter';

  canHandle(ctx: DiscoveryContext): boolean {
    return Boolean(ctx.analysis.hasSitemap || ctx.analysis.sitemapUrls.length > 0);
  }

  getStatus(): string {
    return 'DISCOVERY_SIGNAL_SENT';
  }

  explain(): string {
    return 'Detects XML sitemaps, verifies URL declaration, and verifies sitemap presence.';
  }

  async execute(ctx: DiscoveryContext): Promise<DiscoveryResult> {
    const sitemapUrls = ctx.analysis.sitemapUrls;
    if (sitemapUrls.length === 0) {
      return {
        adapter: this.name,
        handled: false,
        status: 'SKIPPED',
        signalType: 'SITEMAP_CHECK',
        explanation: 'No sitemap declaration found in robots.txt or standard paths.',
      };
    }

    const primarySitemap = sitemapUrls[0];
    const isOwned = Boolean(ctx.matchedProperty);

    try {
      // Parse the primary sitemap to verify presence of target URL
      const parsed = await parseSitemap(primarySitemap);
      const containsUrl = parsed.urls.some((u) => u.toLowerCase() === ctx.normalizedUrl.toLowerCase());

      let explanation = `Found public sitemap at ${primarySitemap} (${parsed.totalExtracted} URLs indexed).`;
      if (containsUrl) {
        explanation += ' Target URL is declared in the sitemap.';
      } else {
        explanation += ' Target URL not explicitly listed in primary sitemap sample.';
      }

      if (!isOwned) {
        explanation += ' (Third-party domain: sitemap not submitted to Google Search Console to preserve tenant integrity).';
      }

      return {
        adapter: this.name,
        handled: true,
        status: 'DISCOVERY_SIGNAL_SENT',
        signalType: 'SITEMAP_VERIFIED',
        explanation,
        details: {
          sitemapFound: true,
          sitemapUrl: primarySitemap,
          sitemapContainsUrl: containsUrl,
          totalSitemapUrls: parsed.totalExtracted,
          isOwnedProperty: isOwned,
        },
      };
    } catch (err: any) {
      return {
        adapter: this.name,
        handled: false,
        status: 'FAILED',
        signalType: 'SITEMAP_VERIFIED',
        explanation: `Failed to inspect sitemap at ${primarySitemap}: ${err.message || 'Network error'}`,
      };
    }
  }
}
