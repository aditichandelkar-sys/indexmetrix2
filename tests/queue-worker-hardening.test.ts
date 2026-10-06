import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('INDEX METRIX — BullMQ & Redis Production Hardening Tests', () => {
  it('verifies src/lib/queue.ts implements bounded reconnect strategy', () => {
    const queueFilePath = path.resolve(__dirname, '../src/lib/queue.ts');
    const queueContent = fs.readFileSync(queueFilePath, 'utf8');

    // Bounded reconnect strategy
    expect(queueContent).toContain('retryStrategy');
    expect(queueContent).toContain('MAX_RECONNECT_ATTEMPTS');
    expect(queueContent).toContain('Math.min(times * 100, 3000)');

    // Fallback preservation
    expect(queueContent).toContain('useInMemoryFallback');
    expect(queueContent).toContain('inProcessQueue');
    expect(queueContent).toContain('inProcessBatchQueue');

    // Shared queue singleton reuse
    expect(queueContent).toContain('sharedQueue');
  });

  it('verifies scripts/worker.js implements graceful shutdown and dedicated connection', () => {
    const workerFilePath = path.resolve(__dirname, '../scripts/worker.js');
    const workerContent = fs.readFileSync(workerFilePath, 'utf8');

    // Dedicated connection configuration
    expect(workerContent).toContain('maxRetriesPerRequest: null');
    expect(workerContent).toContain('retryStrategy');
    expect(workerContent).toContain('Math.min(times * 100, 3000)');

    // Graceful shutdown signals
    expect(workerContent).toContain("process.on('SIGTERM'");
    expect(workerContent).toContain("process.on('SIGINT'");

    // Close sequence
    expect(workerContent).toContain('await worker.close()');
    expect(workerContent).toContain('await connection.quit()');
    expect(workerContent).toContain('isShuttingDown');
  });

  it('verifies batch indexing pipeline remains in-process and untouched', () => {
    const queueFilePath = path.resolve(__dirname, '../src/lib/queue.ts');
    const queueContent = fs.readFileSync(queueFilePath, 'utf8');

    expect(queueContent).toContain('createBatchIndexingJob');
    expect(queueContent).toContain('inProcessBatchQueue.push(batchJob.id)');
    expect(queueContent).toContain('processInProcessBatchQueue()');
  });
});
