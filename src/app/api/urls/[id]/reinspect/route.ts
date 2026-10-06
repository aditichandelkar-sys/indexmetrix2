import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { inspectUrlWithGoogle, normalizeGoogleVerdictToStatus } from '@/lib/google-client';
import { findBestMatchingProperty } from '@/lib/property-matcher';
import { deductCredits } from '@/lib/credit-ledger';

const reinspectSchema = z.object({
  scheduleHours: z.number().int().min(1).max(168).optional(), // 1h to 7 days
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const url = await prisma.url.findFirst({
      where: {
        id: params.id,
        project: user.role === 'OWNER' ? {} : { userId: user.id },
      },
      include: {
        project: true,
      },
    });

    if (!url) {
      return NextResponse.json({ success: false, error: 'URL not found or unauthorized' }, { status: 404 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    const parsed = reinspectSchema.safeParse(body);
    const scheduleHours = parsed.success ? parsed.data.scheduleHours : undefined;

    // If scheduled reinspection requested
    if (scheduleHours) {
      const scheduledTime = new Date(Date.now() + scheduleHours * 3600 * 1000);
      const updated = await prisma.url.update({
        where: { id: url.id },
        data: {
          scheduledReinspectionAt: scheduledTime,
        },
      });

      await prisma.urlStatusHistory.create({
        data: {
          urlId: url.id,
          newStatus: url.status as any,
          source: 'SYSTEM',
          reason: `Reinspection scheduled in ${scheduleHours} hour(s) at ${scheduledTime.toISOString()}`,
        },
      });

      return NextResponse.json({
        success: true,
        message: `Reinspection scheduled in ${scheduleHours} hour(s)`,
        scheduledReinspectionAt: scheduledTime,
        url: updated,
      });
    }

    // Immediate Reinspection
    const isOwner = user.role === 'OWNER' || user.creditMode === 'UNLIMITED';

    // Credit deduction for customer
    if (!isOwner) {
      const deduction = await deductCredits({
        userId: user.id,
        amount: 2,
        operation: 'GOOGLE_INSPECTION',
        referenceId: url.id,
        idempotencyKey: `reinspect_${url.id}_${Math.floor(Date.now() / 60000)}`,
        reason: `Google URL Reinspection for ${url.normalizedUrl}`,
      });

      if (!deduction.success) {
        return NextResponse.json(
          { success: false, error: 'INSUFFICIENT_CREDITS', details: 'Insufficient credits for Google URL inspection.' },
          { status: 402 }
        );
      }
    }

    // Fetch user's authorized Search Console properties
    const userProperties = await prisma.searchConsoleProperty.findMany({
      where: {
        googleAccount: isOwner ? {} : { userId: user.id },
      },
      include: { googleAccount: true },
    });

    const match = findBestMatchingProperty(url.normalizedUrl, userProperties);
    if (!match.property) {
      return NextResponse.json(
        {
          success: false,
          error: 'PROPERTY_NOT_AUTHORIZED',
          message: 'This URL is not covered by an authorized Google Search Console property.',
        },
        { status: 403 }
      );
    }

    const inspection = await inspectUrlWithGoogle(
      match.property.googleAccountId,
      url.normalizedUrl,
      match.property.propertyUrl
    );

    const ir = inspection.inspectionResult;

    const savedInspection = await prisma.googleInspection.create({
      data: {
        urlId: url.id,
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

    const newStatus = normalizeGoogleVerdictToStatus(ir.verdict, ir.coverageState);
    let discoveryStatus = 'DISCOVERY_PENDING';

    if (newStatus === 'INDEXED') {
      discoveryStatus = 'INDEXED_CONFIRMED';
    } else if (
      ir.verdict === 'FAIL' ||
      (ir.robotsTxtState && ir.robotsTxtState !== 'ALLOWED') ||
      (ir.indexingState && ir.indexingState.includes('BLOCKED'))
    ) {
      discoveryStatus = 'BLOCKED';
    } else {
      discoveryStatus = 'GSC_INSPECTED_NOT_INDEXED';
    }

    const updated = await prisma.url.update({
      where: { id: url.id },
      data: {
        status: newStatus as any,
        discoveryStatus,
        matchedPropertyId: match.property.id,
        lastInspectedAt: new Date(),
        lastCrawl: ir.lastCrawlTime ? new Date(ir.lastCrawlTime) : undefined,
        lastGoogleVerdict: ir.verdict,
        lastCoverageState: ir.coverageState || null,
        lastInspectionId: savedInspection.id,
        scheduledReinspectionAt: null,
        ...(newStatus === 'INDEXED' ? { lastIndexedAt: new Date() } : {}),
      },
    });

    await prisma.urlStatusHistory.create({
      data: {
        urlId: url.id,
        newStatus: newStatus as any,
        source: 'GOOGLE_INSPECTION',
        reason: `Reinspection verdict: ${ir.verdict} (${ir.coverageState || 'No coverage state'})`,
      },
    });

    return NextResponse.json({
      success: true,
      url: updated,
      inspectionResult: ir,
      inspectionResultLink: inspection.inspectionResultLink,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
