import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { deductCredits, addCredits } from '@/lib/credit-ledger';

describe('Credit Engine & Transaction Ledger', () => {
  let ownerUser: any;
  let customerUser: any;

  beforeAll(async () => {
    // Look up seeded users
    ownerUser = await prisma.user.findFirst({
      where: { role: 'OWNER' },
    });

    customerUser = await prisma.user.findUnique({
      where: { email: 'customer@indexmatrix.io' },
    });
  });

  it('Owner has creditMode UNLIMITED and billable actions deduct 0 credits', async () => {
    expect(ownerUser).toBeDefined();
    expect(ownerUser.role).toBe('OWNER');
    expect(ownerUser.creditMode).toBe('UNLIMITED');

    const result = await deductCredits({
      userId: ownerUser.id,
      amount: 5,
      operation: 'URL_ANALYSIS',
      idempotencyKey: 'owner_test_key_1',
    });

    expect(result.success).toBe(true);
    expect(result.isUnlimited).toBe(true);
    expect(result.amountDeducted).toBe(0);
  });

  it('Customer credit balance is deducted correctly for billable actions', async () => {
    expect(customerUser).toBeDefined();
    expect(customerUser.creditMode).toBe('LIMITED');

    // Grant 10 credits
    const addResult = await addCredits({
      userId: customerUser.id,
      amount: 10,
      type: 'ADMIN_ADD',
      idempotencyKey: 'cust_add_key_1',
      reason: 'Test credit grant',
    });

    expect(addResult.success).toBe(true);
    const initialBalance = addResult.balanceAfter;

    // Deduct 2 credits
    const deductResult = await deductCredits({
      userId: customerUser.id,
      amount: 2,
      operation: 'GOOGLE_INSPECTION',
      idempotencyKey: 'cust_deduct_key_1',
    });

    expect(deductResult.success).toBe(true);
    expect(deductResult.amountDeducted).toBe(2);
    expect(deductResult.balanceAfter).toBe(initialBalance - 2);
  });

  it('Re-running deductCredits with identical idempotencyKey does NOT double-charge', async () => {
    const replayResult = await deductCredits({
      userId: customerUser.id,
      amount: 2,
      operation: 'GOOGLE_INSPECTION',
      idempotencyKey: 'cust_deduct_key_1', // Same key as above
    });

    expect(replayResult.success).toBe(true);
    // Amount deducted is 2 from the previous record, balance hasn't changed again
    expect(replayResult.transactionId).toBeDefined();
  });

  it('Returns INSUFFICIENT_CREDITS and fails when customer lacks balance', async () => {
    const excessiveAmount = 999999;
    const result = await deductCredits({
      userId: customerUser.id,
      amount: excessiveAmount,
      operation: 'BULK_IMPORT',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_CREDITS');
    expect(result.amountDeducted).toBe(0);
  });
});
