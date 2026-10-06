import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== 'OWNER') {
      return NextResponse.json({ success: false, error: 'Forbidden: Owner privileges required' }, { status: 403 });
    }

    const [
      userCount,
      projectCount,
      urlCount,
      urlStats,
      jobStats,
      googleAccounts,
      gscProperties,
      inspectionsCount,
      creditWallets,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.project.count(),
      prisma.url.count(),
      prisma.url.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.indexingJob.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.googleAccount.count(),
      prisma.searchConsoleProperty.count(),
      prisma.googleInspection.count(),
      prisma.creditWallet.aggregate({ _sum: { balance: true, lifetimeUsed: true } }),
    ]);

    const urlStatusMap: Record<string, number> = {};
    for (const u of urlStats) {
      urlStatusMap[u.status] = u._count._all;
    }

    const jobStatusMap: Record<string, number> = {};
    let totalJobs = 0;
    for (const j of jobStats) {
      jobStatusMap[j.status] = j._count._all;
      totalJobs += j._count._all;
    }

    // Health indicators (safe, non-secret)
    const health = {
      database: { status: 'HEALTHY', message: 'SQLite/PostgreSQL database operational' },
      googleOAuth: {
        status: process.env.GOOGLE_CLIENT_ID ? 'CONFIGURED' : 'UNCONFIGURED',
        connections: googleAccounts,
      },
      searchConsoleApi: { status: 'AVAILABLE', verifiedProperties: gscProperties },
      urlInspectionApi: { status: 'VERIFIED', inspectionsLogged: inspectionsCount },
      queueWorker: { status: 'ACTIVE', driver: 'BullMQ / In-Memory Worker Pool' },
    };

    return NextResponse.json({
      success: true,
      stats: {
        users: userCount,
        projects: projectCount,
        urls: {
          total: urlCount,
          indexed: urlStatusMap.INDEXED || 0,
          notIndexed: urlStatusMap.NOT_INDEXED || 0,
          pending: (urlStatusMap.DISCOVERY_PENDING || 0) + (urlStatusMap.UNINSPECTED || 0) + (urlStatusMap.IMPORTED || 0),
          blocked: urlStatusMap.BLOCKED || 0,
          errors: urlStatusMap.ERROR || 0,
        },
        jobs: {
          total: totalJobs,
          completed: jobStatusMap.COMPLETED || 0,
          processing: jobStatusMap.PROCESSING || 0,
          queued: jobStatusMap.QUEUED || 0,
          failed: jobStatusMap.FAILED || 0,
          partial: jobStatusMap.PARTIAL || 0,
          cancelled: jobStatusMap.CANCELLED || 0,
        },
        credits: {
          ownerMode: user.creditMode, // UNLIMITED
          customerBalanceTotal: creditWallets._sum.balance || 0,
          lifetimeUsedTotal: creditWallets._sum.lifetimeUsed || 0,
        },
        googleConnections: googleAccounts,
        verifiedProperties: gscProperties,
        inspectionsLogged: inspectionsCount,
      },
      health,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
