import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const job = await prisma.indexingJob.findFirst({
      where: {
        id: params.id,
        ...(user.role === 'OWNER' ? {} : { userId: user.id }),
      },
      include: { items: true },
    });

    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
      return NextResponse.json(
        { success: false, error: `Job is already in status ${job.status}` },
        { status: 400 }
      );
    }

    // Cancel queued items
    await prisma.indexingJobItem.updateMany({
      where: {
        jobId: job.id,
        status: { in: ['QUEUED', 'PROCESSING'] },
      },
      data: {
        status: 'CANCELLED',
      },
    });

    const updated = await prisma.indexingJob.update({
      where: { id: job.id },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Job cancelled successfully',
      job: updated,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
