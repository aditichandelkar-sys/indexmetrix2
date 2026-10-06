import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { validateUrlForSSRF } from '@/lib/ssrf';
import { findBestMatchingProperty } from '@/lib/property-matcher';
import { deductCredits, addCredits, CREDIT_COSTS } from '@/lib/credit-ledger';
import { inspectUrlWithGoogle, sanitizeGoogleError } from '@/lib/google-client';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const urlRecord = await prisma.url.findFirst({
      where: {
        id: params.id,
        project: user.role === 'OWNER' ? {} : { userId: user.id },
      },
      include: {
        matchedProperty: {
          include: {
            googleAccount: true,
          },
        },
      },
    });

    if (!urlRecord) {
      return NextResponse.json({ success: false, error: 'URL not found' }, { status: 404 });
    }

    // SSRF Check
    const ssrfCheck = await validateUrlForSSRF(urlRecord.normalizedUrl);
    if (!ssrfCheck.isSafe) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'SSRF_BLOCKED',
            message: `URL security policy violation: ${ssrfCheck.reason}`,
          },
        },
        { status: 403 }
      );
    }

    // Resolve matched property with strict tenant isolation
    let matchedProperty = urlRecord.matchedProperty;
    if (!matchedProperty || !matchedProperty.googleAccount || matchedProperty.googleAccount.userId !== user.id) {
      const userProperties = await prisma.searchConsoleProperty.findMany({
        where: {
          googleAccount: {
            userId: user.id,
            status: 'ACTIVE',
          },
          isVerified: true,
        },
        include: {
          googleAccount: true,
        },
      });

      const match = findBestMatchingProperty(urlRecord.normalizedUrl, userProperties);
      if (match.property) {
        matchedProperty = (userProperties.find((p) => p.id === match.property!.id) as any) || null;
        if (matchedProperty) {
          await prisma.url.update({
            where: { id: urlRecord.id },
            data: { matchedPropertyId: matchedProperty.id },
          });
        }
      }
    }

    if (!matchedProperty || !matchedProperty.googleAccount) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'PROPERTY_NOT_AUTHORIZED',
            message: 'This URL does not match any authorized Google Search Console property connected to your account. Please connect your Google account and verify property ownership on the /google page.',
          },
        },
        { status: 400 }
      );
    }

    const googleAccount = matchedProperty.googleAccount;
    const idempotencyKey = `inspect_${urlRecord.id}_${Date.now()}`;

    // Deduct credits (2 credits for Google Search Console URL inspection, bypassed for OWNER)
    const creditResult = await deductCredits({
      userId: user.id,
      amount: CREDIT_COSTS.GOOGLE_INSPECTION,
      operation: 'GOOGLE_INSPECTION',
      referenceId: urlRecord.id,
      idempotencyKey,
      reason: `Google URL Inspection for ${urlRecord.normalizedUrl}`,
    });

    if (!creditResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: 'Insufficient credits for Google Search Console inspection.',
          },
        },
        { status: 402 }
      );
    }

    // Call official URL Inspection API
    let inspection: any;
    try {
      inspection = await inspectUrlWithGoogle(
        googleAccount.id,
        urlRecord.normalizedUrl,
        matchedProperty.propertyUrl
      );
    } catch (apiErr: any) {
      if (creditResult.amountDeducted > 0) {
        await addCredits({
          userId: user.id,
          amount: creditResult.amountDeducted,
          type: 'REFUND',
          reason: `Refund for failed Google inspection: ${sanitizeGoogleError(apiErr.message)}`,
        });
      }
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'GOOGLE_API_ERROR',
            message: sanitizeGoogleError(apiErr.message),
          },
        },
        { status: 502 }
      );
    }

    const ir = inspection.inspectionResult;

    // Save inspection record
    const savedInspection = await prisma.googleInspection.create({
      data: {
        urlId: urlRecord.id,
        verdict: ir.verdict || 'NEUTRAL',
        coverageState: ir.coverageState || null,
        indexingState: ir.indexingState || null,
        robotsTxtState: ir.robotsTxtState || null,
        pageFetchState: ir.pageFetchState || null,
        googleCanonical: ir.googleCanonical || null,
        userCanonical: ir.userCanonical || null,
        crawledAs: ir.crawledAs || null,
        lastCrawlTime: ir.lastCrawlTime ? new Date(ir.lastCrawlTime) : null,
        rawResponse: JSON.stringify(inspection.raw),
      },
    });

    // Update status accurately
    let newStatus = 'NOT_INDEXED';
    const coverage = (ir.coverageState || '').toLowerCase();
    if (ir.verdict === 'PASS' || coverage.includes('submitted and indexed') || coverage.includes('indexed, not in sitemap')) {
      newStatus = 'INDEXED';
    } else {
      newStatus = 'NOT_INDEXED';
    }

    await prisma.url.update({
      where: { id: urlRecord.id },
      data: {
        status: newStatus as any,
        lastInspectedAt: new Date(),
        lastCrawl: ir.lastCrawlTime ? new Date(ir.lastCrawlTime) : undefined,
        creditsUsed: { increment: creditResult.amountDeducted },
      },
    });

    await prisma.urlStatusHistory.create({
      data: {
        urlId: urlRecord.id,
        newStatus: newStatus as any,
        source: 'GOOGLE_INSPECTION',
        reason: `GSC inspection verdict: ${ir.verdict} (${ir.coverageState || 'No coverage state'})`,
      },
    });

    return NextResponse.json({
      success: true,
      inspection: {
        id: savedInspection.id,
        verdict: ir.verdict,
        coverageState: ir.coverageState || null,
        indexingState: ir.indexingState || null,
        robotsTxtState: ir.robotsTxtState || null,
        pageFetchState: ir.pageFetchState || null,
        googleCanonical: ir.googleCanonical || null,
        userCanonical: ir.userCanonical || null,
        crawledAs: ir.crawledAs || null,
        lastCrawlTime: ir.lastCrawlTime || null,
        referringUrls: ir.referringUrls || [],
        inspectionResultLink: inspection.inspectionResultLink || null,
        inspectedAt: savedInspection.inspectedAt,
      },
      status: newStatus,
      creditsDeducted: creditResult.amountDeducted,
      remainingBalance: creditResult.isUnlimited ? 'UNLIMITED' : creditResult.balanceAfter,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
