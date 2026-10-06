import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { deductCredits, addCredits, CREDIT_COSTS } from '@/lib/credit-ledger';
import { evaluateIndexingApiEligibility } from '@/lib/indexing-eligibility';
import { getValidAccessToken } from '@/lib/google-client';

const GOOGLE_INDEXING_API = 'https://indexing.googleapis.com/v3/urlNotifications:publish';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const urlRecord = await prisma.url.findFirst({
      where: {
        id: params.id,
        project: user.role === 'OWNER' ? {} : { userId: user.id },
      },
      include: {
        matchedProperty: {
          include: { googleAccount: true },
        },
        analyses: {
          orderBy: { analyzedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!urlRecord) {
      return NextResponse.json({ success: false, error: 'URL not found' }, { status: 404 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // body optional
    }

    const forceFastIndex = body?.mode === 'FAST_INDEX';

    // If fast index requested OR url has no matched Search Console property (3rd party link)
    if (forceFastIndex || !urlRecord.matchedProperty || !urlRecord.matchedProperty.googleAccount) {
      const idempotencyKey = `fast_submit_${urlRecord.id}_${Date.now()}`;
      const creditResult = await deductCredits({
        userId: user.id,
        amount: 1,
        operation: 'FAST_INDEX_DISPATCH',
        referenceId: urlRecord.id,
        idempotencyKey,
        reason: `3rd-party Googlebot crawl trigger dispatch: ${urlRecord.normalizedUrl}`,
      });

      if (!creditResult.success && user.creditMode === 'LIMITED') {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'INSUFFICIENT_CREDITS',
              message: 'Insufficient credits for fast index dispatch.',
            },
          },
          { status: 402 }
        );
      }

      const { dispatchFastIndexing } = await import('@/lib/fast-indexer');
      const { getAppBaseUrl } = await import('@/lib/app-config');
      const appBaseUrl = getAppBaseUrl();
      const dispatchSummary = await dispatchFastIndexing(urlRecord.normalizedUrl, { appBaseUrl });

      await prisma.url.update({
        where: { id: urlRecord.id },
        data: {
          status: 'SUBMITTED' as any,
          creditsUsed: { increment: creditResult.amountDeducted },
        },
      });

      await prisma.urlStatusHistory.create({
        data: {
          urlId: urlRecord.id,
          newStatus: 'SUBMITTED' as any,
          source: 'FAST_INDEXER',
          reason: `Pushed through ${dispatchSummary.successfulVectors}/${dispatchSummary.totalVectors} Googlebot crawl vectors (${dispatchSummary.dispatchDurationMs}ms)`,
        },
      });

      return NextResponse.json({
        success: true,
        mode: 'FAST_INDEX',
        status: 'SUBMITTED',
        message: '3rd-Party URL successfully pushed to Googlebot & Search Engine crawl vectors!',
        dispatchSummary,
        creditsDeducted: creditResult.amountDeducted,
      });
    }

    // 2. Validate Google Indexing API Eligibility for verified properties
    const latestAnalysis = urlRecord.analyses[0];
    const isEligible = latestAnalysis ? latestAnalysis.hasStructuredJob : false;

    if (!isEligible) {
      // Return clear educational response explaining Google's official policies, but allow 1-click Fast Indexing
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNSUPPORTED_CONTENT_TYPE',
            message: 'Standard pages cannot use direct GSC Indexing API, but can be pushed immediately via Fast Index Googlebot Crawl Triggers.',
            canFastIndex: true,
            recommendedWorkflow: 'FAST_INDEX',
          },
        },
        { status: 422 }
      );
    }

    // 3. User is submitting an officially eligible JobPosting / BroadcastEvent URL!
    const idempotencyKey = `submit_${urlRecord.id}_${Date.now()}`;
    const creditResult = await deductCredits({
      userId: user.id,
      amount: CREDIT_COSTS.SUPPORTED_INDEXING,
      operation: 'SUPPORTED_INDEXING',
      referenceId: urlRecord.id,
      idempotencyKey,
      reason: `Google Indexing API submission for eligible JobPosting: ${urlRecord.normalizedUrl}`,
    });

    if (!creditResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: 'Insufficient credits for supported indexing API workflow.',
          },
        },
        { status: 402 }
      );
    }

    const googleAccount = urlRecord.matchedProperty.googleAccount;
    const accessToken = await getValidAccessToken(googleAccount.id);

    let apiResponseData: any = {};
    if (accessToken.startsWith('mock_')) {
      if (creditResult.amountDeducted > 0) {
        await addCredits({
          userId: user.id,
          amount: creditResult.amountDeducted,
          type: 'REFUND',
          reason: 'Refund for unconfigured Google account submission attempt',
        });
      }
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CONNECTION_REQUIRED',
            message: 'Live Google account connection required. Google credentials are not configured.',
          },
        },
        { status: 400 }
      );
    } else {
      const response = await fetch(GOOGLE_INDEXING_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: urlRecord.normalizedUrl,
          type: 'URL_UPDATED',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (creditResult.amountDeducted > 0) {
          await addCredits({
            userId: user.id,
            amount: creditResult.amountDeducted,
            type: 'REFUND',
            reason: `Refund for failed Google API submission: ${response.status}`,
          });
        }
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'GOOGLE_API_ERROR',
              message: `Google Indexing API returned error: ${response.status} ${errorText}`,
            },
          },
          { status: 502 }
        );
      }

      apiResponseData = await response.json();
    }

    // Update status to SUBMITTED (Never treat SUBMITTED as INDEXED)
    await prisma.url.update({
      where: { id: urlRecord.id },
      data: {
        status: 'SUBMITTED' as any,
        creditsUsed: { increment: creditResult.amountDeducted },
      },
    });

    await prisma.urlStatusHistory.create({
      data: {
        urlId: urlRecord.id,
        newStatus: 'SUBMITTED' as any,
        source: 'INDEXING_API',
        reason: 'Successfully transmitted to Google Indexing API (URL_UPDATED notification)',
      },
    });

    return NextResponse.json({
      success: true,
      status: 'SUBMITTED',
      message: 'JobPosting update successfully transmitted to Google Indexing API. Crawl evidence will be monitored.',
      apiResponse: apiResponseData,
      creditsDeducted: creditResult.amountDeducted,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
