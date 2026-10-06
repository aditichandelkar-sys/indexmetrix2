import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startTime = Date.now();

  try {
    const [queuedItems, processingItems, failedItems, totalJobs, activeGoogleAccounts] = await Promise.all([
      prisma.indexingJobItem.count({ where: { status: 'QUEUED' } }),
      prisma.indexingJobItem.count({ where: { status: 'PROCESSING' } }),
      prisma.indexingJobItem.count({ where: { status: 'FAILED' } }),
      prisma.indexingJob.count(),
      prisma.googleAccount.count({ where: { status: 'ACTIVE' } }),
    ]);

    const isHealthy = true;

    return NextResponse.json({
      status: isHealthy ? 'healthy' : 'degraded',
      service: 'index-matrix-worker',
      workerHeartbeat: new Date().toISOString(),
      latencyMs: Date.now() - startTime,
      metrics: {
        queueDepth: queuedItems,
        runningJobs: processingItems,
        failedJobs: failedItems,
        totalJobs,
        activeGoogleAccounts,
        googleApiAvailable: activeGoogleAccounts > 0,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: err.message,
        workerHeartbeat: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
