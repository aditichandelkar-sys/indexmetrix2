import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth';
import { analyzeUrl } from '@/lib/analyzer';
import { normalizeUrl } from '@/lib/property-matcher';

export const dynamic = 'force-dynamic';

const analyzeSchema = z.object({
  url: z.string({ required_error: 'URL is required' }).min(4, 'URL is required').trim(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = analyzeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const { url: rawUrl } = parsed.data;

    // Syntax validation
    const { url: parsedUrl, error: urlError } = normalizeUrl(rawUrl);
    if (!parsedUrl || urlError) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid URL: ${urlError || 'Malformed URL format'}`,
        },
        { status: 400 }
      );
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json(
        {
          success: false,
          error: 'Only HTTP and HTTPS protocols are supported.',
        },
        { status: 400 }
      );
    }

    // Execute real technical analysis (with SSRF protection, redirect following, robots.txt, canonical & noindex checks)
    const analysis = await analyzeUrl(parsedUrl.toString());

    return NextResponse.json({
      success: true,
      analysis: {
        url: analysis.url,
        finalUrl: analysis.finalUrl,
        httpStatus: analysis.httpStatus,
        contentType: analysis.contentType,
        reachable: analysis.reachable,
        robotsAllowed: analysis.robotsAllowed,
        noindex: analysis.noindex,
        canonical: analysis.canonical,
        canonicalMatches: analysis.canonicalMatches,
        title: analysis.title,
        wordCount: analysis.wordCount,
        hasSitemap: analysis.hasSitemap,
        sitemapUrls: analysis.sitemapUrls,
        redirectChain: analysis.redirectChain,
        crawlable: analysis.crawlable,
        discoveryEligible: analysis.discoveryEligible,
        warnings: analysis.warnings,
        documentType: analysis.documentType,
        isThirdPartyHosted: analysis.isThirdPartyHosted,
        pdfDetails: analysis.pdfDetails,
        responseTimeMs: analysis.responseTimeMs,
        issues: analysis.issues,
        passedAudit: analysis.passedAudit,
        hasStructuredJob: analysis.hasStructuredJob,
        analyzedAt: analysis.analyzedAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Failed to analyze URL',
      },
      { status: 500 }
    );
  }
}
