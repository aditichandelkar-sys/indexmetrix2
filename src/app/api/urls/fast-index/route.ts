import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { deductCredits } from '@/lib/credit-ledger';
import { dispatchFastIndexing, FastIndexExecutionSummary } from '@/lib/fast-indexer';
import { normalizeUrl } from '@/lib/property-matcher';
import { getMasterServiceAccount } from '@/lib/google-service-account';
import { validateTargetPreflight } from '@/lib/target-preflight';

const fastIndexSchema = z.object({
  urls: z.array(z.string().min(4)).min(1, 'At least one URL is required'),
  projectId: z.string().optional(),
  idempotencyKey: z.string().optional(),
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

    const { urls: rawUrls, projectId: reqProjectId, idempotencyKey: bodyIdempotencyKey } = parsed.data;
    const batchIdempotencyKey = bodyIdempotencyKey || req.headers.get('idempotency-key') || null;

    // Idempotency: Return existing completed job if idempotency key was previously processed
    if (batchIdempotencyKey) {
      const existingJob = await prisma.indexingJob.findUnique({
        where: { idempotencyKey: batchIdempotencyKey },
        include: {
          items: {
            include: {
              url: { select: { id: true, normalizedUrl: true, status: true } },
            },
          },
        },
      });

      if (existingJob) {
        return NextResponse.json({
          success: true,
          totalRequested: existingJob.totalUrls,
          dispatchedCount: existingJob.completedUrls,
          invalidCount: 0,
          invalidUrls: [],
          job: existingJob,
          idempotent: true,
        });
      }
    }

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

    // 3. Process each valid URL through Secure Pre-flight Gate, Credit Ledger, and Fast Indexer
    const { getAppBaseUrl } = await import('@/lib/app-config');
    const appBaseUrl = getAppBaseUrl();
    const results: FastIndexExecutionSummary[] = [];
    const processedSuccessItems: Array<{ urlRecord: any; dispatchSummary: FastIndexExecutionSummary; creditsCharged: number }> = [];

    const startTime = Date.now();

    for (const item of validUrls) {
      // 3a. Secure Pre-Flight Reachability & Health Check BEFORE deducting any credits
      const preflight = await validateTargetPreflight(item.normalized);
      if (!preflight.canDispatch) {
        invalidUrls.push({
          url: item.original,
          reason: preflight.errorMessage || 'Target pre-flight verification failed',
        });

        results.push({
          targetUrl: item.normalized,
          overallStatus: 'FAILED',
          totalVectors: 1,
          successfulVectors: 0,
          rejectedVectors: preflight.isDead || preflight.status === 'BLOCKED_SSRF' ? 1 : 0,
          failedVectors: preflight.isDead || preflight.status === 'BLOCKED_SSRF' ? 0 : 1,
          vectors: [
            {
              vector: 'TARGET_PREFLIGHT',
              name: 'Target Reachability & Health Gate',
              status: preflight.isDead || preflight.status === 'BLOCKED_SSRF' ? 'REJECTED' : 'FAILED',
              statusCode: preflight.httpStatus || undefined,
              latencyMs: preflight.latencyMs,
              message: preflight.errorMessage || 'Target URL reachability check failed.',
              timestamp: new Date().toISOString(),
            },
          ],
          dispatchDurationMs: preflight.latencyMs,
          scheduledNextCheck: new Date().toISOString(),
        });
        continue;
      }

      // 3b. Deduct 1 credit per fast index dispatch (ONLY for pre-flight verified URLs)
      const itemKey = batchIdempotencyKey
        ? `fast_index_${batchIdempotencyKey}_${Buffer.from(item.normalized).toString('base64url').slice(0, 16)}`
        : `fast_index_${user.id}_${Buffer.from(item.normalized).toString('base64url')}`;

      const creditResult = await deductCredits({
        userId: user.id,
        amount: 1,
        operation: 'FAST_INDEX_DISPATCH',
        idempotencyKey: itemKey,
        reason: `Fast Googlebot Crawl Dispatch: ${item.normalized}`,
      });

      if (!creditResult.success && user.creditMode === 'LIMITED') {
        results.push({
          targetUrl: item.normalized,
          overallStatus: 'FAILED',
          totalVectors: 0,
          successfulVectors: 0,
          failedVectors: 1,
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

      // Execute multi-vector crawl triggers using opaque server-side URL record ID
      const dispatchSummary = await dispatchFastIndexing(item.normalized, {
        appBaseUrl,
        relaySlug: urlRecord.id,
      });

      // Google Indexing API Capability & Eligibility Gate
      const masterCreds = await getMasterServiceAccount();
      if (masterCreds) {
        dispatchSummary.vectors.push({
          vector: 'GOOGLE_INDEXING_API',
          name: 'Official Google Indexing API',
          status: 'SKIPPED',
          latencyMs: 0,
          message:
            'Skipped: Google Indexing API is strictly restricted to JobPosting and BroadcastEvent structured data.',
          timestamp: new Date().toISOString(),
        });
        dispatchSummary.totalVectors++;
        dispatchSummary.skippedVectors = (dispatchSummary.skippedVectors || 0) + 1;
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
      processedSuccessItems.push({
        urlRecord,
        dispatchSummary,
        creditsCharged: creditResult.amountDeducted,
      });
    }

    const dispatchedCount = results.filter((r) => r.overallStatus !== 'FAILED').length;

    // 4. Job Persistence: Ensure latest submissions ALWAYS appear in Indexing Jobs
    let jobRecord: any = null;
    if (processedSuccessItems.length > 0) {
      try {
        const totalCharged = processedSuccessItems.reduce((acc, p) => acc + p.creditsCharged, 0);
        jobRecord = await prisma.$transaction(async (tx) => {
          const job = await tx.indexingJob.create({
            data: {
              userId: user.id,
              projectId,
              type: 'DISCOVERY_AND_INSPECTION',
              status: dispatchedCount === rawUrls.length ? 'COMPLETED' : dispatchedCount > 0 ? 'PARTIAL' : 'FAILED',
              totalUrls: processedSuccessItems.length,
              queuedUrls: 0,
              processingUrls: 0,
              completedUrls: dispatchedCount,
              failedUrls: processedSuccessItems.length - dispatchedCount,
              creditsCharged: totalCharged,
              creditsRefunded: 0,
              idempotencyKey: batchIdempotencyKey || null,
              startedAt: new Date(startTime),
              completedAt: new Date(),
              metadata: JSON.stringify({
                provider: 'MULTI_VECTOR_ENGINE',
                dispatchedCount,
                source: 'FAST_INDEX_API',
              }),
            },
          });

          for (const item of processedSuccessItems) {
            await tx.indexingJobItem.create({
              data: {
                jobId: job.id,
                urlId: item.urlRecord.id,
                status: item.dispatchSummary.overallStatus === 'FAILED' ? 'FAILED' : 'COMPLETED',
                attempts: 1,
                maxAttempts: 3,
                startedAt: new Date(startTime),
                completedAt: new Date(),
                operationResult: JSON.stringify(item.dispatchSummary),
              },
            });
          }

          return job;
        });
      } catch (jobErr) {
        console.error('[Fast-Index] Note on job persistence transaction:', jobErr);
      }
    }

    // If all submitted URLs failed (e.g. dead link 404 or SSRF), report clear failure
    if (dispatchedCount === 0 && results.length > 0) {
      const firstFailure = results[0];
      const isDead = firstFailure.vectors.some((v) => v.message.includes('Confirmed dead') || v.statusCode === 404 || v.statusCode === 410);
      return NextResponse.json(
        {
          success: false,
          error: firstFailure.vectors[0]?.message || 'All target URLs failed reachability pre-flight verification.',
          totalRequested: rawUrls.length,
          dispatchedCount: 0,
          invalidCount: invalidUrls.length,
          invalidUrls,
          results,
        },
        { status: isDead ? 422 : 400 }
      );
    }

    return NextResponse.json({
      success: true,
      totalRequested: rawUrls.length,
      dispatchedCount,
      invalidCount: invalidUrls.length,
      invalidUrls,
      results,
      job: jobRecord,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
