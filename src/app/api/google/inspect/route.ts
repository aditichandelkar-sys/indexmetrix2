import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { validateUrlForSSRF } from '@/lib/ssrf';
import { normalizeUrl, findBestMatchingProperty } from '@/lib/property-matcher';
import { deductCredits, addCredits, CREDIT_COSTS } from '@/lib/credit-ledger';
import { inspectUrlWithGoogle, sanitizeGoogleError, normalizeGoogleVerdictToStatus } from '@/lib/google-client';
import { isThirdPartyProject } from '@/lib/project-utils';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const inspectRequestSchema = z.object({
  projectId: z.string().regex(UUID_REGEX, 'Invalid project ID. Must be a valid UUID.').optional(),
  url: z.string().min(3, 'URL is required').optional(),
  urlId: z.string().regex(UUID_REGEX, 'Invalid URL ID. Must be a valid UUID.').optional(),
}).refine((data) => (data.projectId && data.url) || data.urlId, {
  message: 'Either (projectId and url) or (urlId) must be provided.',
});

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = inspectRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { projectId: inputProjectId, url: inputUrl, urlId: inputUrlId } = parsed.data;

    // 2. Resolve URL record and Project with ownership check
    let urlRecord: any = null;
    let project: any = null;

    if (inputUrlId) {
      urlRecord = await prisma.url.findFirst({
        where: {
          id: inputUrlId,
          project: user.role === 'OWNER' ? {} : { userId: user.id },
        },
        include: {
          project: true,
          matchedProperty: { include: { googleAccount: true } },
        },
      });

      if (!urlRecord) {
        return NextResponse.json({ success: false, error: 'URL not found or unauthorized' }, { status: 404 });
      }
      project = urlRecord.project;
    } else if (inputProjectId && inputUrl) {
      // 2. Check project ownership
      project = await prisma.project.findFirst({
        where: {
          id: inputProjectId,
          ...(user.role === 'OWNER' ? {} : { userId: user.id }),
        },
      });

      if (!project) {
        return NextResponse.json({ success: false, error: 'Project not found or unauthorized' }, { status: 404 });
      }

      if (isThirdPartyProject(project)) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'PROPERTY_NOT_AUTHORIZED',
              message: 'Third-party projects cannot be inspected via Google Search Console. Google URL Inspection is only available for verified owned properties.',
            },
          },
          { status: 400 }
        );
      }

      // 3. Normalize URL and validate syntax
      const { url: parsedTargetUrl, error: urlError } = normalizeUrl(inputUrl);
      if (!parsedTargetUrl || urlError) {
        return NextResponse.json({ success: false, error: `Invalid URL: ${urlError || 'Malformed URL format'}` }, { status: 400 });
      }

      const targetUrlStr = parsedTargetUrl.toString();

      // Find or create URL record under project
      urlRecord = await prisma.url.findFirst({
        where: {
          projectId: project.id,
          normalizedUrl: targetUrlStr,
        },
        include: {
          project: true,
          matchedProperty: { include: { googleAccount: true } },
        },
      });

      if (!urlRecord) {
        urlRecord = await prisma.url.create({
          data: {
            projectId: project.id,
            originalUrl: inputUrl,
            normalizedUrl: targetUrlStr,
            hostname: parsedTargetUrl.hostname,
            path: parsedTargetUrl.pathname,
            status: 'INSPECTION_PENDING',
          },
          include: {
            project: true,
            matchedProperty: { include: { googleAccount: true } },
          },
        });
      }
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

    // 4 & 5. Check Search Console property authorization & resolve siteUrl
    let matchedProperty = urlRecord.matchedProperty;
    if (!matchedProperty || !matchedProperty.googleAccount || (user.role !== 'OWNER' && matchedProperty.googleAccount.userId !== user.id)) {
      // Find all active verified properties for this user
      const userProperties = await prisma.searchConsoleProperty.findMany({
        where: {
          googleAccount: {
            ...(user.role === 'OWNER' ? {} : { userId: user.id }),
            status: 'ACTIVE',
          },
          isVerified: true,
        },
        include: {
          googleAccount: true,
        },
      });

      // Check project linked property first if available
      const projectLinkedProp = userProperties.find(
        (p) =>
          (project?.googlePropertyId && p.id === project.googlePropertyId) ||
          (project?.googlePropertyUrl && p.propertyUrl === project.googlePropertyUrl) ||
          (p.projectId === project?.id)
      );

      if (projectLinkedProp && findBestMatchingProperty(urlRecord.normalizedUrl, [projectLinkedProp]).property) {
        matchedProperty = projectLinkedProp;
      } else {
        const match = findBestMatchingProperty(urlRecord.normalizedUrl, userProperties);
        if (match.property) {
          matchedProperty = userProperties.find((p) => p.id === match.property!.id) || null;
        }
      }

      if (matchedProperty) {
        await prisma.url.update({
          where: { id: urlRecord.id },
          data: { matchedPropertyId: matchedProperty.id },
        });
      }
    }

    if (!matchedProperty || !matchedProperty.googleAccount) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'PROPERTY_NOT_AUTHORIZED',
            message: 'This URL does not match any authorized Google Search Console property connected to your account. Please link your Google account and verify domain/URL prefix ownership on the /google page.',
          },
        },
        { status: 400 }
      );
    }

    const googleAccount = matchedProperty.googleAccount;
    const siteUrl = matchedProperty.propertyUrl;
    const idempotencyKey = `gsc_inspect_${urlRecord.id}_${Date.now()}`;

    // 13. Deduct credit (2 credits for Google Search Console URL inspection, bypassed for OWNER)
    const creditResult = await deductCredits({
      userId: user.id,
      amount: CREDIT_COSTS.GOOGLE_INSPECTION,
      operation: 'GOOGLE_INSPECTION',
      referenceId: urlRecord.id,
      idempotencyKey,
      reason: `Google Search Console URL inspection for ${urlRecord.normalizedUrl}`,
    });

    if (!creditResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: 'Insufficient credits for Google Search Console inspection (Requires 2 credits).',
          },
        },
        { status: 402 }
      );
    }

    // 6, 7 & 8. Call Google's official URL Inspection API (handles token decrypt & refresh)
    let inspection: any;
    try {
      inspection = await inspectUrlWithGoogle(
        googleAccount.id,
        urlRecord.normalizedUrl,
        siteUrl
      );
    } catch (apiErr: any) {
      // Do not deduct credits if the inspection was not successfully executed because of an error
      if (creditResult.amountDeducted > 0) {
        await addCredits({
          userId: user.id,
          amount: creditResult.amountDeducted,
          type: 'REFUND',
          reason: `Automatic refund for failed Google inspection: ${sanitizeGoogleError(apiErr.message)}`,
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

    // 9. Parse response
    const ir = inspection.inspectionResult;

    // 10. Store result in GoogleInspection
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

    // 11. Normalize status
    const newStatus = normalizeGoogleVerdictToStatus(ir.verdict, ir.coverageState);

    await prisma.url.update({
      where: { id: urlRecord.id },
      data: {
        status: newStatus,
        lastInspectedAt: new Date(),
        lastCrawl: ir.lastCrawlTime ? new Date(ir.lastCrawlTime) : undefined,
        lastGoogleVerdict: ir.verdict,
        lastCoverageState: ir.coverageState || null,
        lastInspectionId: savedInspection.id,
        ...(newStatus === 'INDEXED' ? { lastIndexedAt: new Date() } : {}),
        creditsUsed: { increment: creditResult.amountDeducted },
      },
    });

    // 12. Create URL status history entry
    await prisma.urlStatusHistory.create({
      data: {
        urlId: urlRecord.id,
        newStatus,
        source: 'GOOGLE_INSPECTION',
        reason: `Google Inspection verdict: ${ir.verdict} (${ir.coverageState || 'No coverage state'})`,
      },
    });

    const inspectionData = {
      id: savedInspection.id,
      urlId: urlRecord.id,
      targetUrl: urlRecord.normalizedUrl,
      siteUrl,
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
    };

    // 14. Return normalized JSON
    return NextResponse.json({
      success: true,
      inspection: inspectionData,
      inspectionResult: inspectionData,
      inspectionResultLink: inspection.inspectionResultLink || null,
      status: newStatus,
      creditsDeducted: creditResult.amountDeducted,
      remainingBalance: creditResult.isUnlimited ? 'UNLIMITED' : creditResult.balanceAfter,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
