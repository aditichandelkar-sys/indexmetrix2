import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { processBatchIndexingJob } from '@/lib/queue';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const job = await prisma.indexingJob.findFirst({
      where: {
        id: params.id,
        ...(user.role === 'OWNER' ? {} : { userId: user.id }),
      },
      include: {
        items: {
          where: { status: 'FAILED' },
        },
      },
    });

    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    if (job.items.length === 0) {
      return NextResponse.json({ success: false, error: 'No failed items to retry in this job' }, { status: 400 });
    }

    // Reset failed items to QUEUED
    await prisma.indexingJobItem.updateMany({
      where: {
        jobId: job.id,
        status: 'FAILED',
      },
      data: {
        status: 'QUEUED',
        attempts: 0,
        lastError: null,
      },
    });

    // Reset job status to QUEUED
    const updated = await prisma.indexingJob.update({
      where: { id: job.id },
      data: {
        status: 'QUEUED',
        queuedUrls: job.items.length,
        failedUrls: 0,
      },
    });

    // Trigger async processing
    setTimeout(() => {
      processBatchIndexingJob(job.id);
    }, 10);

    return NextResponse.json({
      success: true,
      message: `Retrying ${job.items.length} failed items`,
      job: updated,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
