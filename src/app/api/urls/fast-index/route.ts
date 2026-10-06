import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { deductCredits } from '@/lib/credit-ledger';
import { dispatchFastIndexing, FastIndexExecutionSummary } from '@/lib/fast-indexer';
import { normalizeUrl } from '@/lib/property-matcher';
import { getMasterServiceAccount, publishToGoogleIndexingApi } from '@/lib/google-service-account';

const fastIndexSchema = z.object({
  urls: z.array(z.string().min(4)).min(1, 'At least one URL is required'),
  projectId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const parsed = fastIndexSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { urls: rawUrls, projectId: reqProjectId } = parsed.data;

    // 1. Resolve or auto-create a default project for 3rd-party URLs
    let projectId = reqProjectId;
    if (!projectId) {
      let defaultProject = await prisma.project.findFirst({
        where: {
          userId: user.id,
          name: '3rd-Party & External Links',
        },
      });

      if (!defaultProject) {
        defaultProject = await prisma.project.create({
          data: {
            userId: user.id,
            name: '3rd-Party & External Links',
            domain: 'third-party-links.io',
            description: 'Automated workspace for 3rd-party URLs, backlinks, forums, and external content indexing.',
          },
        });
      }
      projectId = defaultProject.id;
    }

    // 2. Validate and deduplicate URLs
    const validUrls: Array<{ original: string; normalized: string; hostname: string; path: string }> = [];
    const invalidUrls: Array<{ url: string; reason: string }> = [];

    for (const raw of rawUrls) {
      const trimmed = raw.trim();
      if (!trimmed) continue;

      const { url: parsedUrl, error } = normalizeUrl(trimmed);
      if (!parsedUrl || error) {
        invalidUrls.push({ url: trimmed, reason: error || 'Invalid URL syntax' });
        continue;
      }

      validUrls.push({
        original: trimmed,
        normalized: parsedUrl.toString(),
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
      });
    }

    if (validUrls.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No valid URLs provided',
          invalidUrls,
        },
        { status: 400 }
      );
    }

    // 3. Process each valid URL through Credit Ledger and Fast Indexer
    const { getAppBaseUrl } = await import('@/lib/app-config');
    const appBaseUrl = getAppBaseUrl();
    const results: FastIndexExecutionSummary[] = [];

    for (const item of validUrls) {
      // Deduct 1 credit per fast index dispatch
      const idempotencyKey = `fast_index_${user.id}_${Buffer.from(item.normalized).toString('base64url')}_${Date.now()}`;
      const creditResult = await deductCredits({
        userId: user.id,
        amount: 1,
        operation: 'FAST_INDEX_DISPATCH',
        idempotencyKey,
        reason: `Fast Googlebot Crawl Dispatch: ${item.normalized}`,
      });

      if (!creditResult.success && user.creditMode === 'LIMITED') {
        results.push({
          targetUrl: item.normalized,
          overallStatus: 'FAILED',
          totalVectors: 0,
          successfulVectors: 0,
          vectors: [
            {
              vector: 'CREDIT_ENGINE',
              name: 'Credit Engine Check',
              status: 'FAILED',
              latencyMs: 1,
              message: 'Insufficient credits to dispatch fast indexing for this URL.',
              timestamp: new Date().toISOString(),
            },
          ],
          dispatchDurationMs: 0,
          scheduledNextCheck: new Date().toISOString(),
        });
        continue;
      }

      // Upsert URL into database
      const urlRecord = await prisma.url.upsert({
        where: {
          projectId_normalizedUrl: {
            projectId,
            normalizedUrl: item.normalized,
          },
        },
        update: {
          status: 'SUBMITTED' as any,
          creditsUsed: { increment: creditResult.amountDeducted },
        },
        create: {
          projectId,
          originalUrl: item.original,
          normalizedUrl: item.normalized,
          hostname: item.hostname,
          path: item.path,
          status: 'SUBMITTED' as any,
          creditsUsed: creditResult.amountDeducted,
        },
      });

      // Execute multi-vector crawl triggers
      const dispatchSummary = await dispatchFastIndexing(item.normalized, { appBaseUrl });

      // If Master Google Service Account is configured, verify eligibility before calling Indexing API
      const masterCreds = await getMasterServiceAccount();
      if (masterCreds) {
        // Google Indexing API is strictly restricted to supported content per Google's official documentation
        dispatchSummary.vectors.push({
          vector: 'GOOGLE_INDEXING_API',
          name: 'Official Google Indexing API',
          status: 'SKIPPED',
          latencyMs: 1,
          message: 'Google Indexing API is restricted to supported content types (JobPosting / BroadcastEvent). Standard third-party pages are not eligible.',
          timestamp: new Date().toISOString(),
        });
        dispatchSummary.totalVectors++;
      }

      // Record audit history
      await prisma.urlStatusHistory.create({
        data: {
          urlId: urlRecord.id,
          newStatus: 'SUBMITTED' as any,
          source: 'FAST_INDEXER',
          reason: `Pushed through ${dispatchSummary.successfulVectors}/${dispatchSummary.totalVectors} Googlebot & Search Engine vectors (${dispatchSummary.dispatchDurationMs}ms)`,
        },
      });

      results.push(dispatchSummary);
    }

    return NextResponse.json({
      success: true,
      totalRequested: rawUrls.length,
      dispatchedCount: results.filter((r) => r.overallStatus !== 'FAILED').length,
      invalidCount: invalidUrls.length,
      invalidUrls,
      results,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
