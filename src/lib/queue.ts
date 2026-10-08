import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from './db';
import { analyzeUrl } from './analyzer';
import { inspectUrlWithGoogle } from './google-client';
import { findBestMatchingProperty } from './property-matcher';
import { deductCredits, addCredits } from './credit-ledger';
import { GoogleIndexingApiService } from './google-indexing-api';
import { executeDiscoveryPipeline } from './discovery/engine';

const REDIS_URL = process.env.REDIS_URL;
let redisConnection: IORedis | null = null;
let useInMemoryFallback = true;
let sharedQueue: Queue | null = null;

const MAX_RECONNECT_ATTEMPTS = 20;

// Attempt Redis connection if REDIS_URL configured
if (REDIS_URL && !REDIS_URL.includes('mock') && !REDIS_URL.includes('disabled')) {
  try {
    redisConnection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        if (times > MAX_RECONNECT_ATTEMPTS) {
          console.warn(`[Queue] Redis reconnect limit reached (${MAX_RECONNECT_ATTEMPTS} attempts); falling back to in-process worker mode`);
          useInMemoryFallback = true;
          return null;
        }
        // Bounded exponential backoff: 100ms, 200ms, ... capped at 3000ms
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
    });

    redisConnection.on('ready', () => {
      useInMemoryFallback = false;
      console.log('[Queue] Connected to Redis successfully');
    });

    redisConnection.on('close', () => {
      useInMemoryFallback = true;
    });

    redisConnection.on('error', () => {
      // Suppress unhandled crash and preserve resilient in-process fallback
      useInMemoryFallback = true;
    });

    redisConnection
      .connect()
      .then(() => {
        useInMemoryFallback = false;
      })
      .catch(() => {
        useInMemoryFallback = true;
        console.log('[Queue] Redis not reachable; running in resilient in-process worker mode');
      });
  } catch {
    useInMemoryFallback = true;
  }
}

export interface JobData {
  jobId: string;
  userId: string;
  projectId?: string;
  urlId?: string;
  operation: 'ANALYZE' | 'INSPECT' | 'SUBMIT_SUPPORTED' | 'SITEMAP_DISCOVERY';
  targetUrl: string;
  metadata?: any;
}

// In-process fallback task queues
const inProcessQueue: JobData[] = [];
let isProcessingInProcess = false;

const inProcessBatchQueue: string[] = [];
let isProcessingBatchInProcess = false;

async function processInProcessQueue() {
  if (isProcessingInProcess) return;
  isProcessingInProcess = true;

  while (inProcessQueue.length > 0) {
    const jobData = inProcessQueue.shift();
    if (!jobData) break;
    await executeJobHandler(jobData);
  }

  isProcessingInProcess = false;
}

async function processInProcessBatchQueue() {
  if (isProcessingBatchInProcess) return;
  isProcessingBatchInProcess = true;

  while (inProcessBatchQueue.length > 0) {
    const batchJobId = inProcessBatchQueue.shift();
    if (!batchJobId) break;
    await processBatchIndexingJob(batchJobId);
  }

  isProcessingBatchInProcess = false;
}

/**
 * Universal Legacy Job Execution Handler (for single IndexJob)
 */
export async function executeJobHandler(data: JobData): Promise<void> {
  const { jobId, urlId, operation, targetUrl, metadata } = data;

  await prisma.indexJob.update({
    where: { id: jobId },
    data: {
      status: 'PROCESSING',
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  try {
    if (operation === 'ANALYZE') {
      const result = await analyzeUrl(targetUrl);

      if (urlId) {
        await prisma.urlAnalysis.create({
          data: {
            urlId,
            httpStatus: result.httpStatus,
            redirectChain: JSON.stringify(result.redirectChain),
            responseTimeMs: result.responseTimeMs,
            contentType: result.contentType,
            title: result.title,
            metaDescription: result.metaDescription,
            robotsMeta: result.robotsMeta,
            canonicalUrl: result.canonicalUrl,
            xRobotsTag: result.xRobotsTag,
            robotsTxtStatus: result.robotsTxtStatus,
            issues: JSON.stringify(result.issues),
            passedAudit: result.passedAudit,
            hasStructuredJob: result.hasStructuredJob,
          },
        });

        let newStatus = 'ANALYZED';
        if (result.issues.some((i) => i.issue === 'NOINDEX' || i.issue === 'ROBOTS_BLOCKED')) {
          newStatus = 'BLOCKED';
        } else if (result.httpStatus >= 400 || result.httpStatus === 0) {
          newStatus = 'ERROR';
        }

        await prisma.url.update({
          where: { id: urlId },
          data: {
            status: newStatus as any,
            httpStatus: result.httpStatus,
            lastAnalyzedAt: new Date(),
          },
        });

        await prisma.urlStatusHistory.create({
          data: {
            urlId,
            newStatus: newStatus as any,
            source: 'ANALYSIS',
            reason: `Technical analysis completed: HTTP ${result.httpStatus}, ${result.issues.length} issue(s)`,
          },
        });
      }
    } else if (operation === 'INSPECT') {
      const { googleAccountId, propertyUrl } = metadata || {};
      if (!googleAccountId || !propertyUrl) {
        throw new Error('Missing Google Account or Property for inspection');
      }

      const inspection = await inspectUrlWithGoogle(googleAccountId, targetUrl, propertyUrl);
      const ir = inspection.inspectionResult;

      if (urlId) {
        const savedInspection = await prisma.googleInspection.create({
          data: {
            urlId,
            verdict: ir.verdict || 'NEUTRAL',
            coverageState: ir.coverageState || null,
            indexingState: ir.indexingState || null,
            robotsTxtState: ir.robotsTxtState || null,
            pageFetchState: ir.pageFetchState || null,
            googleCanonical: ir.googleCanonical || null,
            userCanonical: ir.userCanonical || null,
            crawledAs: ir.crawledAs || null,
            lastCrawlTime: ir.lastCrawlTime ? new Date(ir.lastCrawlTime) : null,
            rawResponse: JSON.stringify(inspection.raw),
          },
        });

        let newStatus = 'NOT_INDEXED';
        if (ir.verdict === 'PASS' || (ir.coverageState && ir.coverageState.toLowerCase().includes('indexed'))) {
          newStatus = 'INDEXED';
        } else if (ir.verdict === 'FAIL' || (ir.coverageState && ir.coverageState.toLowerCase().includes('not indexed'))) {
          newStatus = 'NOT_INDEXED';
        }

        await prisma.url.update({
          where: { id: urlId },
          data: {
            status: newStatus as any,
            lastInspectedAt: new Date(),
            lastCrawl: ir.lastCrawlTime ? new Date(ir.lastCrawlTime) : undefined,
            lastGoogleVerdict: ir.verdict,
            lastCoverageState: ir.coverageState || null,
            lastInspectionId: savedInspection.id,
            ...(newStatus === 'INDEXED' ? { lastIndexedAt: new Date() } : {}),
          },
        });

        await prisma.urlStatusHistory.create({
          data: {
            urlId,
            newStatus: newStatus as any,
            source: 'GOOGLE_INSPECTION',
            reason: `GSC inspection verdict: ${ir.verdict} (${ir.coverageState || 'No coverage state'})`,
          },
        });
      }
    }

    await prisma.indexJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    await prisma.indexAttempt.create({
      data: {
        jobId,
        attemptNumber: 1,
        status: 'SUCCESS',
      },
    });
  } catch (err: any) {
    await prisma.indexJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        error: err.message || 'Job execution error',
      },
    });

    await prisma.indexAttempt.create({
      data: {
        jobId,
        attemptNumber: 1,
        status: 'FAILED',
        error: err.message,
      },
    });
  }
}

/**
 * Enqueues a legacy single job
 */
export async function enqueueJob(data: JobData): Promise<void> {
  if (useInMemoryFallback || !redisConnection) {
    inProcessQueue.push(data);
    setTimeout(() => {
      processInProcessQueue();
    }, 10);
    return;
  }

  try {
    if (!sharedQueue) {
      sharedQueue = new Queue('index-matrix-jobs', { connection: redisConnection });
    }
    await sharedQueue.add(data.operation, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  } catch {
    // If Redis enqueue fails dynamically, fall back safely to in-process execution
    inProcessQueue.push(data);
    setTimeout(() => {
      processInProcessQueue();
    }, 10);
  }
}

// =========================================================================
// BATCH COMMERCIAL INDEXING / DISCOVERY JOB SYSTEM
// =========================================================================

export interface CreateBatchJobParams {
  userId: string;
  projectId: string;
  urlIds: string[];
  type?: 'DISCOVERY_AND_INSPECTION' | 'OFFICIAL_INDEXING_API' | 'REINSPECT';
  idempotencyKey?: string;
  metadata?: any;
}

export interface CreateBatchJobResult {
  success: boolean;
  job?: any;
  error?: string;
}

/**
 * Creates a batch IndexingJob and IndexingJobItems, verifies permissions and credits,
 * and enqueues for queue/worker processing.
 */
export async function createBatchIndexingJob(params: CreateBatchJobParams): Promise<CreateBatchJobResult> {
  const { userId, projectId, urlIds, type = 'DISCOVERY_AND_INSPECTION', idempotencyKey, metadata } = params;

  if (!urlIds || urlIds.length === 0) {
    return { success: false, error: 'No URLs specified for indexing job' };
  }

  // Idempotency check
  if (idempotencyKey) {
    const existing = await prisma.indexingJob.findUnique({
      where: { idempotencyKey },
      include: { items: true },
    });
    if (existing) {
      return { success: true, job: existing };
    }
  }

  // Verify user & project
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { wallet: true },
  });
  if (!user) return { success: false, error: 'User not found' };

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...(user.role === 'OWNER' ? {} : { userId: user.id }),
    },
  });
  if (!project) return { success: false, error: 'Project not found or unauthorized' };

  // Verify URLs belong to project
  const urls = await prisma.url.findMany({
    where: {
      id: { in: urlIds },
      projectId: project.id,
    },
    select: { id: true, normalizedUrl: true },
  });

  if (urls.length === 0) {
    return { success: false, error: 'No valid URLs found in project for job' };
  }

  // Credit balance check for CUSTOMER
  const isOwner = user.role === 'OWNER' || user.creditMode === 'UNLIMITED';
  const creditsNeeded = isOwner ? 0 : urls.length;

  if (!isOwner) {
    const currentBalance = user.wallet?.balance || 0;
    if (currentBalance < creditsNeeded) {
      return {
        success: false,
        error: `Insufficient credits. Required: ${creditsNeeded}, Available: ${currentBalance}. Please purchase credits to proceed.`,
      };
    }
  }

  // Create IndexingJob and IndexingJobItems in transaction
  const batchJob = await prisma.$transaction(async (tx) => {
    const job = await tx.indexingJob.create({
      data: {
        userId: user.id,
        projectId: project.id,
        type,
        status: 'QUEUED',
        totalUrls: urls.length,
        queuedUrls: urls.length,
        processingUrls: 0,
        completedUrls: 0,
        failedUrls: 0,
        idempotencyKey: idempotencyKey || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    const itemsData = urls.map((u) => ({
      jobId: job.id,
      urlId: u.id,
      status: 'QUEUED',
      attempts: 0,
      maxAttempts: 3,
    }));

    await tx.indexingJobItem.createMany({
      data: itemsData,
    });

    return job;
  });

  // Enqueue for processing: Use Redis/BullMQ when available while preserving in-process fallback
  if (!useInMemoryFallback && redisConnection) {
    try {
      if (!sharedQueue) {
        sharedQueue = new Queue('index-matrix-jobs', { connection: redisConnection });
      }
      await sharedQueue.add('BATCH_INDEXING', { batchJobId: batchJob.id }, {
        jobId: `batch_${batchJob.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      console.log(`[Queue] Enqueued batch job ${batchJob.id} to BullMQ queue`);
    } catch (err) {
      console.warn('[Queue] BullMQ enqueue failed; falling back to in-process queue:', err);
      inProcessBatchQueue.push(batchJob.id);
      setTimeout(() => {
        processInProcessBatchQueue();
      }, 20);
    }
  } else {
    inProcessBatchQueue.push(batchJob.id);
    setTimeout(() => {
      processInProcessBatchQueue();
    }, 20);
  }

  const fullJob = await prisma.indexingJob.findUnique({
    where: { id: batchJob.id },
    include: {
      items: {
        include: {
          url: { select: { id: true, normalizedUrl: true, status: true } },
        },
      },
    },
  });

  return { success: true, job: fullJob };
}

/**
 * Executes a batch indexing/discovery job
 */
export async function processBatchIndexingJob(batchJobId: string): Promise<void> {
  const job = await prisma.indexingJob.findUnique({
    where: { id: batchJobId },
    include: {
      user: { include: { wallet: true } },
      project: {
        include: {
          properties: {
            include: { googleAccount: true },
          },
        },
      },
      items: {
        include: {
          url: true,
        },
      },
    },
  });

  if (!job || job.status === 'CANCELLED') return;

  await prisma.indexingJob.update({
    where: { id: job.id },
    data: {
      status: 'PROCESSING',
      startedAt: new Date(),
      processingUrls: job.items.length,
      queuedUrls: 0,
    },
  });

  const isOwner = job.user.role === 'OWNER' || job.user.creditMode === 'UNLIMITED';

  // Fetch all user's authorized Search Console properties across all connected accounts
  const userProperties = await prisma.searchConsoleProperty.findMany({
    where: {
      googleAccount: isOwner ? {} : { userId: job.userId },
    },
    include: { googleAccount: true },
  });

  for (const item of job.items) {
    // Check if job was cancelled mid-flight
    const currentJob = await prisma.indexingJob.findUnique({
      where: { id: job.id },
      select: { status: true },
    });
    if (currentJob?.status === 'CANCELLED') break;

    // Mark item PROCESSING
    await prisma.indexingJobItem.update({
      where: { id: item.id },
      data: {
        status: 'PROCESSING',
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    let creditCharged = false;

    try {
      // 1. Deduct 1 credit for customer (0 for owner)
      if (!isOwner) {
        const deduction = await deductCredits({
          userId: job.userId,
          amount: 1,
          operation: 'DISCOVERY_INSPECTION',
          referenceId: item.id,
          idempotencyKey: `batch_item_${item.id}`,
          reason: `Indexing/Discovery job for ${item.url.normalizedUrl}`,
        });

        if (!deduction.success) {
          throw new Error('Credit deduction failed: ' + (deduction.error || 'Insufficient balance'));
        }
        creditCharged = true;
        await prisma.indexingJob.update({
          where: { id: job.id },
          data: { creditsCharged: { increment: 1 } },
        });
      }

      // 2. Technical crawlability & accessibility analysis
      const analysisResult = await analyzeUrl(item.url.normalizedUrl);

      await prisma.urlAnalysis.create({
        data: {
          urlId: item.urlId,
          httpStatus: analysisResult.httpStatus,
          redirectChain: JSON.stringify(analysisResult.redirectChain),
          responseTimeMs: analysisResult.responseTimeMs,
          contentType: analysisResult.contentType,
          title: analysisResult.title,
          metaDescription: analysisResult.metaDescription,
          robotsMeta: analysisResult.robotsMeta,
          canonicalUrl: analysisResult.canonicalUrl,
          xRobotsTag: analysisResult.xRobotsTag,
          robotsTxtStatus: analysisResult.robotsTxtStatus,
          issues: JSON.stringify(analysisResult.issues),
          passedAudit: analysisResult.passedAudit,
          hasStructuredJob: analysisResult.hasStructuredJob,
        },
      });

      // Check if URL is associated with IndexInstantly provider
      let jobMeta: any = null;
      try {
        if (job.metadata) jobMeta = JSON.parse(job.metadata);
      } catch {
        jobMeta = null;
      }

      const isIndexInstantly =
        item.url.provider === 'INDEXINSTANTLY' ||
        jobMeta?.provider === 'INDEXINSTANTLY' ||
        Boolean(item.url.providerBatchId || jobMeta?.batchId);

      const batchId = item.url.providerBatchId || jobMeta?.batchId;

      if (isIndexInstantly && batchId) {
        const { getBatchStatus } = await import('./indexinstantly');
        const statusRes = await getBatchStatus(batchId);

        if (statusRes.success && statusRes.data) {
          const providerStatus = statusRes.data.status;
          const normalized = statusRes.data.normalizedStatus; // 'SUBMITTED' | 'PROCESSING' | 'INDEXED' | 'FAILED' | 'BLOCKED'

          const updateData: any = {
            provider: 'INDEXINSTANTLY',
            providerBatchId: batchId,
            providerStatus,
            lastCheckedAt: new Date(),
          };

          if (normalized === 'INDEXED') {
            updateData.status = 'INDEXED';
            updateData.lastIndexedAt = new Date();
          } else if (normalized === 'PROCESSING') {
            updateData.status = 'PROCESSING';
          } else if (normalized === 'FAILED') {
            updateData.status = 'FAILED';
            updateData.providerError = statusRes.data.raw?.error || 'Provider reported indexing failure';
          } else if (normalized === 'BLOCKED') {
            updateData.status = 'BLOCKED';
            updateData.providerError = 'Refused by content rule';
          } else {
            // queued / duplicate / pending
            updateData.status = 'SUBMITTED';
          }

          await prisma.url.update({
            where: { id: item.urlId },
            data: updateData,
          });

          await prisma.urlStatusHistory.create({
            data: {
              urlId: item.urlId,
              newStatus: updateData.status,
              source: 'INDEXINSTANTLY',
              reason: `IndexInstantly batch status: ${providerStatus} (Batch ID: ${batchId})`,
            },
          });

          const itemJobStatus =
            normalized === 'INDEXED'
              ? 'COMPLETED'
              : normalized === 'FAILED'
              ? 'FAILED'
              : 'PROCESSING';

          await prisma.indexingJobItem.update({
            where: { id: item.id },
            data: {
              status: itemJobStatus,
              completedAt: normalized === 'INDEXED' || normalized === 'FAILED' ? new Date() : null,
              lastError: normalized === 'FAILED' ? (statusRes.data.raw?.error || 'Indexing failed') : null,
              operationResult: JSON.stringify({
                provider: 'INDEXINSTANTLY',
                batchId,
                status: providerStatus,
                normalizedStatus: normalized,
                details: statusRes.data,
              }),
            },
          });

          continue;
        }
      }

      // 3. Search Console Property Matching
      const match = findBestMatchingProperty(item.url.normalizedUrl, userProperties);
      const matchedProperty = match.property;

      // 4. Pluggable Commercial Discovery & Inspection Execution
      const discoveryResult = await executeDiscoveryPipeline({
        urlId: item.urlId,
        originalUrl: item.url.originalUrl,
        normalizedUrl: item.url.normalizedUrl,
        userId: job.userId,
        projectId: job.projectId,
        analysis: analysisResult,
        userProperties,
        matchedProperty,
        requestedJobType: job.type as any,
      });

      await prisma.indexingJobItem.update({
        where: { id: item.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          operationResult: JSON.stringify(discoveryResult),
        },
      });
    } catch (itemErr: any) {
      const isFinalAttempt = item.attempts >= item.maxAttempts;

      await prisma.indexingJobItem.update({
        where: { id: item.id },
        data: {
          status: isFinalAttempt ? 'FAILED' : 'QUEUED',
          lastError: itemErr.message || 'Operation failed',
          completedAt: isFinalAttempt ? new Date() : null,
          nextRetryAt: isFinalAttempt ? null : new Date(Date.now() + Math.pow(2, item.attempts) * 2000),
        },
      });

      // If credit was charged and operation permanently failed, refund the credit
      if (creditCharged && !isOwner && isFinalAttempt) {
        await addCredits({
          userId: job.userId,
          amount: 1,
          type: 'REFUND',
          idempotencyKey: `refund_item_${item.id}`,
          reason: `Automatic refund for failed indexing job item ${item.id}`,
          referenceId: item.id,
        });

        await prisma.indexingJob.update({
          where: { id: job.id },
          data: { creditsRefunded: { increment: 1 } },
        });
      }
    }

    // Refresh job progress counters
    const itemStats = await prisma.indexingJobItem.groupBy({
      by: ['status'],
      where: { jobId: job.id },
      _count: { _all: true },
    });

    let completed = 0;
    let failed = 0;
    let processing = 0;
    let queued = 0;

    for (const stat of itemStats) {
      if (stat.status === 'COMPLETED') completed = stat._count._all;
      else if (stat.status === 'FAILED') failed = stat._count._all;
      else if (stat.status === 'PROCESSING') processing = stat._count._all;
      else if (stat.status === 'QUEUED') queued = stat._count._all;
    }

    await prisma.indexingJob.update({
      where: { id: job.id },
      data: {
        completedUrls: completed,
        failedUrls: failed,
        processingUrls: processing,
        queuedUrls: queued,
      },
    });
  }

  // Final job status transition
  const finalItems = await prisma.indexingJobItem.findMany({
    where: { jobId: job.id },
    select: { status: true },
  });

  const total = finalItems.length;
  const completedCount = finalItems.filter((i) => i.status === 'COMPLETED').length;
  const failedCount = finalItems.filter((i) => i.status === 'FAILED').length;
  const processingCount = finalItems.filter((i) => i.status === 'PROCESSING').length;

  let finalStatus = 'COMPLETED';
  if (processingCount > 0) finalStatus = 'PROCESSING';
  else if (failedCount === total) finalStatus = 'FAILED';
  else if (failedCount > 0) finalStatus = 'PARTIAL';

  await prisma.indexingJob.update({
    where: { id: job.id },
    data: {
      status: finalStatus,
      completedAt: finalStatus === 'PROCESSING' ? null : new Date(),
      processingUrls: processingCount,
      queuedUrls: 0,
      completedUrls: completedCount,
      failedUrls: failedCount,
    },
  });

  // If there are still items processing from IndexInstantly, schedule the next status check asynchronously
  if (processingCount > 0) {
    let jobMeta: any = null;
    try {
      if (job.metadata) jobMeta = JSON.parse(job.metadata);
    } catch {
      jobMeta = null;
    }

    if (jobMeta?.provider === 'INDEXINSTANTLY' || job.items.some((i) => i.url.provider === 'INDEXINSTANTLY')) {
      const pollCount = (jobMeta?.pollCount || 0) + 1;
      const MAX_POLLS = 10;
      if (pollCount < MAX_POLLS) {
        await prisma.indexingJob.update({
          where: { id: job.id },
          data: {
            metadata: JSON.stringify({ ...jobMeta, pollCount }),
          },
        });

        const pollDelay = 15000; // 15 seconds

        if (!useInMemoryFallback && redisConnection) {
          try {
            if (!sharedQueue) {
              sharedQueue = new Queue('index-matrix-jobs', { connection: redisConnection });
            }
            await sharedQueue.add('BATCH_INDEXING', { batchJobId: job.id }, {
              jobId: `batch_${job.id}_poll_${pollCount}`,
              delay: pollDelay,
              removeOnComplete: 100,
              removeOnFail: 500,
            });
          } catch {
            setTimeout(() => {
              inProcessBatchQueue.push(job.id);
              processInProcessBatchQueue();
            }, pollDelay);
          }
        } else {
          setTimeout(() => {
            inProcessBatchQueue.push(job.id);
            processInProcessBatchQueue();
          }, pollDelay);
        }
      }
    }
  }
}
