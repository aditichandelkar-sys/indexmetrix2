import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { analyzeUrl } from '@/lib/analyzer';
import { findBestMatchingProperty } from '@/lib/property-matcher';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const url = await prisma.url.findFirst({
      where: {
        id: params.id,
        project: user.role === 'OWNER' ? {} : { userId: user.id },
      },
      include: { project: true },
    });

    if (!url) {
      return NextResponse.json({ success: false, error: 'URL not found or unauthorized' }, { status: 404 });
    }

    // 1. Technical crawlability & accessibility check
    const analysis = await analyzeUrl(url.normalizedUrl);

    await prisma.urlAnalysis.create({
      data: {
        urlId: url.id,
        httpStatus: analysis.httpStatus,
        redirectChain: JSON.stringify(analysis.redirectChain),
        responseTimeMs: analysis.responseTimeMs,
        contentType: analysis.contentType,
        title: analysis.title,
        metaDescription: analysis.metaDescription,
        robotsMeta: analysis.robotsMeta,
        canonicalUrl: analysis.canonicalUrl,
        xRobotsTag: analysis.xRobotsTag,
        robotsTxtStatus: analysis.robotsTxtStatus,
        issues: JSON.stringify(analysis.issues),
        passedAudit: analysis.passedAudit,
        hasStructuredJob: analysis.hasStructuredJob,
      },
    });

    // 2. Check property coverage
    const userProperties = await prisma.searchConsoleProperty.findMany({
      where: {
        googleAccount: user.role === 'OWNER' ? {} : { userId: user.id },
      },
      include: { googleAccount: true },
    });

    const match = findBestMatchingProperty(url.normalizedUrl, userProperties);

    // 3. Recommended discovery actions
    const recommendations: string[] = [];
    if (!match.property) {
      recommendations.push('Connect and authorize the Search Console property that covers this domain/prefix.');
    }
    if (analysis.httpStatus >= 400 || analysis.httpStatus === 0) {
      recommendations.push(`Fix HTTP error ${analysis.httpStatus} so Googlebot can access the page.`);
    }
    if (analysis.robotsTxtStatus === 'DISALLOWED') {
      recommendations.push('Remove robots.txt disallow rules blocking Googlebot.');
    }
    if (analysis.issues.some((i) => i.issue === 'NOINDEX')) {
      recommendations.push('Remove <meta name="robots" content="noindex"> tag to permit Google indexing.');
    }
    if (!url.project.domain) {
      recommendations.push('Add an XML sitemap to your project containing this URL.');
    } else {
      recommendations.push(`Ensure this URL is present in ${url.project.domain}/sitemap.xml and submitted to Google Search Console.`);
    }

    const newStatus = analysis.passedAudit ? 'DISCOVERY_PENDING' : 'BLOCKED';

    const updated = await prisma.url.update({
      where: { id: url.id },
      data: {
        status: newStatus as any,
        discoveryStatus: 'DISCOVERY_ACTIVE',
        httpStatus: analysis.httpStatus,
        lastAnalyzedAt: new Date(),
        matchedPropertyId: match.property?.id || null,
      },
    });

    await prisma.urlStatusHistory.create({
      data: {
        urlId: url.id,
        newStatus: newStatus as any,
        source: 'DISCOVERY_WORKFLOW',
        reason: `Discovery workflow initiated. HTTP ${analysis.httpStatus}. ${recommendations.length} recommended action(s).`,
      },
    });

    return NextResponse.json({
      success: true,
      url: updated,
      analysis: {
        httpStatus: analysis.httpStatus,
        passedAudit: analysis.passedAudit,
        issues: analysis.issues,
      },
      propertyCoverage: {
        isCovered: !!match.property,
        matchedPropertyUrl: match.property?.propertyUrl || null,
      },
      recommendations,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
