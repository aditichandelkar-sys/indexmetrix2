import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { validateUrlForSSRF } from '@/lib/ssrf';
import { normalizeUrl, findBestMatchingProperty } from '@/lib/property-matcher';
import { deductCredits, addCredits, CREDIT_COSTS } from '@/lib/credit-ledger';
import { inspectUrlWithGoogle, sanitizeGoogleError } from '@/lib/google-client';
import { isThirdPartyProject } from '@/lib/project-utils';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const inspectUrlSchema = z.object({
  url: z.string({ required_error: 'Target URL is required' }).min(4, 'Target URL is required').trim(),
  projectId: z
    .string({
      required_error: 'Please select a project before submitting a URL.',
      invalid_type_error: 'Please select a project before submitting a URL.',
    })
    .trim()
    .min(1, 'Please select a project before submitting a URL.')
    .regex(UUID_REGEX, 'Invalid project ID. Must be a valid UUID.'),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    // Safe diagnostic logging (strictly no tokens, keys, passwords, or secrets)
    console.log('[Safe Diagnostic] POST /api/urls/inspect:', {
      projectIdExists: body?.projectId !== undefined && body?.projectId !== null && body?.projectId !== '',
      projectIdType: typeof body?.projectId,
      projectIdFormatValidUUID: typeof body?.projectId === 'string' && UUID_REGEX.test(body.projectId),
      submittedUrlType: typeof body?.url,
      authenticatedUserExists: !!user,
    });

    const parsed = inspectUrlSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: parsed.error.errors[0].message } },
        { status: 400 }
      );
    }

    const { url: rawUrl, projectId } = parsed.data;

    // 1. Syntax & Protocol Validation
    const { url: parsedUrl, error: urlError } = normalizeUrl(rawUrl);
    if (!parsedUrl || urlError) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_URL', message: `Invalid URL: ${urlError || 'Malformed syntax'}` } },
        { status: 400 }
      );
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_PROTOCOL', message: 'Only HTTP and HTTPS protocols are supported.' } },
        { status: 400 }
      );
    }

    const normalizedUrl = parsedUrl.toString();

    // 2. SSRF Protection (localhost, 127.0.0.1, private IP ranges, link-local, cloud metadata)
    const ssrfCheck = await validateUrlForSSRF(normalizedUrl);
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

    // 3. Verify Project belongs to user (or OWNER)
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        ...(user.role === 'OWNER' ? {} : { userId: user.id }),
      },
      include: {
        properties: true,
      },
    });

    if (!project) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: 'Project not found or you do not have permission to access it.',
          },
        },
        { status: 404 }
      );
    }

    // Third-party projects cannot use Google Search Console URL inspection
    if (isThirdPartyProject(project)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'PROPERTY_NOT_AUTHORIZED',
            message: 'The submitted URL is in a third-party project and cannot be inspected via Google Search Console. Google URL Inspection is only available for verified owned properties, not 3rd-party URLs. Use "Submit for Indexing" for third-party discovery.',
          },
        },
        { status: 400 }
      );
    }

    // 4. Tenant Isolation & Property Matching
    // Retrieve verified properties belonging exclusively to the current user's connected Google accounts
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

    if (userProperties.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NO_CONNECTED_ACCOUNT',
            message: 'No active Google Search Console accounts connected. Connect your Google account on the /google page first.',
          },
        },
        { status: 400 }
      );
    }

    // Check which connected Search Console property owns / covers the submitted URL
    const match = findBestMatchingProperty(normalizedUrl, userProperties);
    if (!match.property) {
      const authorizedList = userProperties.map((p) => p.propertyUrl).join(', ');
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'PROPERTY_NOT_AUTHORIZED',
            message: `The submitted URL is not covered by any authorized Google Search Console property connected to your account. Your authorized properties: [${authorizedList}].`,
          },
        },
        { status: 400 }
      );
    }

    const matchedProperty = userProperties.find((p) => p.id === match.property!.id)!;
    const googleAccount = matchedProperty.googleAccount;
    const targetProjectId = project.id;

    // 5. Upsert URL record
    const urlRecord = await prisma.url.upsert({
      where: {
        projectId_normalizedUrl: {
          projectId: targetProjectId,
          normalizedUrl,
        },
      },
      update: {
        matchedPropertyId: matchedProperty.id,
      },
      create: {
        projectId: targetProjectId,
        originalUrl: rawUrl,
        normalizedUrl,
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        status: 'IMPORTED',
        matchedPropertyId: matchedProperty.id,
      },
    });

    // 6. Credit Deduction (Idempotent; OWNER has creditMode: UNLIMITED)
    const idempotencyKey = `inspect_${urlRecord.id}_${Date.now()}`;
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
            message: 'Insufficient credits for Google Search Console URL inspection.',
          },
        },
        { status: 402 }
      );
    }

    // 7. Call Google Search Console URL Inspection API
    let inspection: any;
    try {
      inspection = await inspectUrlWithGoogle(
        googleAccount.id,
        urlRecord.normalizedUrl,
        matchedProperty.propertyUrl
      );
    } catch (apiErr: any) {
      // Refund credits immediately if Google API call fails
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
            message: sanitizeGoogleError(apiErr.message || 'Google URL Inspection API call failed'),
          },
        },
        { status: 502 }
      );
    }

    const ir = inspection.inspectionResult;

    // 8. Store inspection history in database
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

    // 9. Update URL Status accurately:
    // Never claim INDEXED unless Google verdict is PASS or coverageState explicitly indicates indexed
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

    // 10. Audit history record
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
      url: {
        id: urlRecord.id,
        normalizedUrl: urlRecord.normalizedUrl,
        status: newStatus,
      },
      matchedProperty: {
        id: matchedProperty.id,
        propertyUrl: matchedProperty.propertyUrl,
        permissionLevel: matchedProperty.permissionLevel,
      },
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
    console.error('Unexpected error in /api/urls/inspect:', err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err.message || 'Internal server error during URL inspection',
        },
      },
      { status: 500 }
    );
  }
}
