import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const job = await prisma.indexingJob.findFirst({
      where: {
        id: params.id,
        ...(user.role === 'OWNER' ? {} : { userId: user.id }),
      },
      include: {
        project: { select: { id: true, name: true, domain: true } },
        items: {
          include: {
            url: {
              select: {
                id: true,
                originalUrl: true,
                normalizedUrl: true,
                status: true,
                lastGoogleVerdict: true,
                lastCoverageState: true,
                lastInspectedAt: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    const progressPercentage =
      job.totalUrls > 0 ? Math.round(((job.completedUrls + job.failedUrls) / job.totalUrls) * 100) : 0;

    return NextResponse.json({
      success: true,
      job,
      progressPercentage,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
