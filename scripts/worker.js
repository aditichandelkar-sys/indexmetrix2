const fs = require('fs');
const path = require('path');

// Auto-load .env
if (!process.env.DATABASE_URL && fs.existsSync(path.resolve(__dirname, '../.env'))) {
  const envContent = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}

const { Worker } = require('bullmq');
const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL;

console.log('==============================================');
console.log('INDEX MATRIX — BACKGROUND WORKER PROCESS');
console.log('==============================================');

if (!REDIS_URL || REDIS_URL.includes('mock') || REDIS_URL.includes('disabled')) {
  console.log('[Worker] No external Redis URL detected.');
  console.log('[Worker] Background tasks are running in resilient in-process worker mode inside the Next.js service.');
  console.log('[Worker] To run dedicated Redis workers, start Redis and set REDIS_URL in .env');
  process.exit(0);
}

try {
  const MAX_RECONNECT_ATTEMPTS = 20;
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      if (times > MAX_RECONNECT_ATTEMPTS) {
        console.warn(`[Worker] Redis reconnect limit reached (${MAX_RECONNECT_ATTEMPTS} attempts); stopping worker.`);
        return null;
      }
      return Math.min(times * 100, 3000);
    },
  });

  connection.on('error', (err) => {
    console.error('[Worker] Redis connection error:', err.message);
  });

  const createJiti = require('jiti');
  const jiti = createJiti(process.cwd());
  const { processBatchIndexingJob, executeJobHandler } = jiti('./src/lib/queue.ts');

  const worker = new Worker(
    'index-matrix-jobs',
    async (job) => {
      console.log(`[Worker] Processing Job ID ${job.id} (Op: ${job.name})`);
      if (job.name === 'BATCH_INDEXING' || job.data?.batchJobId) {
        const batchJobId = job.data.batchJobId || job.data.jobId;
        console.log(`[Worker] Executing real batch indexing job: ${batchJobId}`);
        await processBatchIndexingJob(batchJobId);
        return { success: true, batchJobId, processedAt: new Date().toISOString() };
      }

      console.log(`[Worker] Executing real job handler for: ${job.data?.targetUrl || job.id}`);
      await executeJobHandler(job.data);
      return { success: true, jobId: job.id, processedAt: new Date().toISOString() };
    },
    { connection, concurrency: 10 }
  );

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed successfully.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Worker] BullMQ worker error:', err.message);
  });

  console.log('[Worker] Listening for background jobs on queue: index-matrix-jobs');

  // Graceful shutdown handling (SIGTERM & SIGINT)
  let isShuttingDown = false;
  async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[Worker] Received ${signal}. Starting graceful shutdown...`);

    try {
      console.log('[Worker] Pausing worker and awaiting completion of active jobs...');
      await worker.close();
      console.log('[Worker] BullMQ worker closed.');

      if (connection.status !== 'end') {
        await connection.quit().catch(() => {});
      }
      console.log('[Worker] Dedicated Redis connection closed.');

      console.log('[Worker] Graceful shutdown completed cleanly.');
      process.exit(0);
    } catch (err) {
      console.error('[Worker] Error during graceful shutdown:', err.message);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
} catch (e) {
  console.error('[Worker] Failed to start dedicated worker:', e.message);
  process.exit(1);
}
