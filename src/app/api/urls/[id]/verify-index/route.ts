import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { SearchVerificationAdapter } from '@/lib/discovery/adapters/SearchVerificationAdapter';
import { analyzeUrl } from '@/lib/analyzer';
import { findBestMatchingProperty } from '@/lib/property-matcher';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const urlRecord = await prisma.url.findFirst({
      where: {
        id: params.id,
        project: user.role === 'OWNER' ? {} : { userId: user.id },
      },
      include: {
        project: true,
        matchedProperty: {
          include: { googleAccount: true },
        },
      },
    });

    if (!urlRecord) {
      return NextResponse.json({ success: false, error: 'URL not found or unauthorized' }, { status: 404 });
    }

    // Retrieve user's verified properties to verify if domain is owned
    const userProperties = await prisma.searchConsoleProperty.findMany({
      where: {
        googleAccount: user.role === 'OWNER' ? {} : { userId: user.id },
        isVerified: true,
      },
      include: { googleAccount: true },
    });

    const match = findBestMatchingProperty(urlRecord.normalizedUrl, userProperties);
    const matchedProperty = match.property;

    // Quick fresh analysis
    const analysis = await analyzeUrl(urlRecord.normalizedUrl);

    // 1. If URL was submitted through IndexInstantly, query provider status
    if (urlRecord.provider === 'INDEXINSTANTLY' && urlRecord.providerBatchId) {
      const { getBatchStatus } = await import('@/lib/indexinstantly');
      const batchRes = await getBatchStatus(urlRecord.providerBatchId);

      if (batchRes.success && batchRes.data) {
        const rawStatus = batchRes.data.status;
        const normalized = batchRes.data.normalizedStatus;

        if (normalized === 'INDEXED') {
          await prisma.url.update({
            where: { id: urlRecord.id },
            data: {
              status: 'INDEXED',
              providerStatus: rawStatus,
              lastIndexedAt: new Date(),
              lastCheckedAt: new Date(),
              discoveryStatus: 'INDEXED_CONFIRMED',
            },
          });

          await prisma.urlStatusHistory.create({
            data: {
              urlId: urlRecord.id,
              newStatus: 'INDEXED',
              source: 'INDEXINSTANTLY',
              reason: `IndexInstantly verified batch status: ${rawStatus}`,
            },
          });

          return NextResponse.json({
            success: true,
            url: urlRecord.normalizedUrl,
            verification: {
              result: 'INDEXED_CONFIRMED',
              verificationMethod: 'INDEXINSTANTLY',
              explanation: `IndexInstantly confirmed URL indexing (Status: ${rawStatus})`,
              details: batchRes.data,
            },
          });
        } else {
          await prisma.url.update({
            where: { id: urlRecord.id },
            data: {
              status: normalized as any,
              providerStatus: rawStatus,
              lastCheckedAt: new Date(),
              ...(normalized === 'FAILED'
                ? { providerError: batchRes.data.raw?.error || 'Provider reported indexing failure' }
                : {}),
            },
          });
        }
      }
    }

    const adapter = new SearchVerificationAdapter();
    const verification = await adapter.verify({
      urlId: urlRecord.id,
      originalUrl: urlRecord.originalUrl,
      normalizedUrl: urlRecord.normalizedUrl,
      userId: user.id,
      projectId: urlRecord.projectId,
      analysis,
      userProperties,
      matchedProperty,
    });

    // Update URL if verified indexed
    if (verification.result === 'INDEXED_CONFIRMED' || verification.result === 'INDEXED_OBSERVED') {
      await prisma.url.update({
        where: { id: urlRecord.id },
        data: {
          status: 'INDEXED',
          lastIndexedAt: new Date(),
          discoveryStatus: verification.result,
        },
      });

      await prisma.urlStatusHistory.create({
        data: {
          urlId: urlRecord.id,
          newStatus: 'INDEXED',
          source: verification.verificationMethod,
          reason: verification.explanation,
        },
      });
    }

    return NextResponse.json({
      success: true,
      url: urlRecord.normalizedUrl,
      verification,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Failed to verify index status',
      },
      { status: 500 }
    );
  }
}
