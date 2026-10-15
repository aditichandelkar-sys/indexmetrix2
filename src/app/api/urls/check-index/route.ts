import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { checkGoogleIndexStatus } from '@/lib/serp-checker';
import { normalizeUrl } from '@/lib/property-matcher';

const checkSchema = z.object({
  url: z.string().min(4),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const parsed = checkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid URL' }, { status: 400 });
    }

    const rawTarget = parsed.data.url.trim();
    const { url: normalizedObj } = normalizeUrl(rawTarget);
    const normalizedUrl = normalizedObj ? normalizedObj.toString() : rawTarget;

    // Run strict SERP verification against Google
    const statusReport = await checkGoogleIndexStatus(normalizedUrl);

    // Update database status if record exists for this user / project
    const existingUrl = await prisma.url.findFirst({
      where: {
        OR: [
          { normalizedUrl },
          { originalUrl: rawTarget },
        ],
        project: user.role === 'OWNER' ? {} : { userId: user.id },
      },
    });

    if (existingUrl) {
      const now = new Date();

      if (statusReport.verificationState === 'CONFIRMED_INDEXED') {
        // Genuine verification confirmed exact URL in public SERP
        await prisma.url.update({
          where: { id: existingUrl.id },
          data: {
            status: 'INDEXED',
            lastIndexedAt: now,
            lastInspectedAt: now,
            discoveryStatus: 'INDEXED_CONFIRMED',
            // CRITICAL: Do NOT set lastCrawl here. A SERP check is an indexing observation,
            // not a Googlebot crawl event. Googlebot crawl events are tracked via server telemetry.
          },
        });

        await prisma.urlStatusHistory.create({
          data: {
            urlId: existingUrl.id,
            newStatus: 'INDEXED',
            source: 'GOOGLE_SERP_CHECK',
            reason: statusReport.details,
          },
        });
      } else {
        // NOT_INDEXED or UNABLE_TO_VERIFY: Do not claim indexing.
        // Update inspection timestamp without fabricating crawl or premature indexing status.
        await prisma.url.update({
          where: { id: existingUrl.id },
          data: {
            lastInspectedAt: now,
            discoveryStatus: statusReport.verificationState,
          },
        });

        await prisma.urlStatusHistory.create({
          data: {
            urlId: existingUrl.id,
            newStatus: existingUrl.status,
            source: 'GOOGLE_SERP_CHECK',
            reason: statusReport.details,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      report: statusReport,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Verification failed' }, { status: 500 });
  }
}
