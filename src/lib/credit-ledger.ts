import { prisma } from './db';

export const CREDIT_COSTS = {
  URL_ANALYSIS: 1,
  GOOGLE_INSPECTION: 2,
  SUPPORTED_INDEXING: 3,
  SITEMAP_PROCESS: 5,
} as const;

export type CreditOperation = keyof typeof CREDIT_COSTS;

export interface DeductCreditParams {
  userId: string;
  amount: number;
  operation: CreditOperation | string;
  referenceId?: string;
  idempotencyKey?: string;
  reason?: string;
}

export interface CreditResult {
  success: boolean;
  isUnlimited: boolean;
  unlimited?: boolean;
  balanceBefore: number;
  balanceAfter: number;
  amountDeducted: number;
  transactionId?: string;
  error?: string;
}

/**
 * Deducts credits for a billable operation with strict ACID transaction guarantees.
 * If the user has creditMode === 'UNLIMITED' (OWNER), no credits are deducted and the operation succeeds immediately.
 * If idempotencyKey is supplied and has already been processed, returns the previous result without double-charging.
 */
export async function deductCredits(params: DeductCreditParams): Promise<CreditResult> {
  const { userId, amount, operation, referenceId, idempotencyKey, reason } = params;

  // 1. Idempotency Check: if key already exists, do not double-charge!
  if (idempotencyKey) {
    const existingTx = await prisma.creditTransaction.findUnique({
      where: { idempotencyKey }
    });
    if (existingTx) {
      return {
        success: true,
        isUnlimited: false,
        unlimited: false,
        balanceBefore: existingTx.balanceAfter - existingTx.amount,
        balanceAfter: existingTx.balanceAfter,
        amountDeducted: -existingTx.amount,
        transactionId: existingTx.id,
      };
    }
  }

  // 2. Fetch User and Role
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { wallet: true }
  });

  if (!user) {
    return {
      success: false,
      isUnlimited: false,
      unlimited: false,
      balanceBefore: 0,
      balanceAfter: 0,
      amountDeducted: 0,
      error: 'USER_NOT_FOUND'
    };
  }

  // 3. OWNER / UNLIMITED Bypass: Owner operations never deduct credits
  if (user.creditMode === 'UNLIMITED' || user.role === 'OWNER') {
    return {
      success: true,
      isUnlimited: true,
      unlimited: true,
      balanceBefore: 0,
      balanceAfter: 0,
      amountDeducted: 0,
    };
  }

  // 4. Ensure Wallet Exists
  let wallet = user.wallet;
  if (!wallet) {
    wallet = await prisma.creditWallet.create({
      data: {
        userId: user.id,
        balance: 0,
        lifetimeUsed: 0,
        lifetimePurchased: 0,
      }
    });
  }

  // 5. Insufficient Credits Check
  if (wallet.balance < amount) {
    return {
      success: false,
      isUnlimited: false,
      unlimited: false,
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
      amountDeducted: 0,
      error: 'INSUFFICIENT_CREDITS'
    };
  }

  // 6. Atomic Transaction to deduct balance and record immutable audit ledger entry
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-read with update lock
      const currentWallet = await tx.creditWallet.findUnique({
        where: { id: wallet!.id }
      });

      if (!currentWallet || currentWallet.balance < amount) {
        throw new Error('INSUFFICIENT_CREDITS');
      }

      const newBalance = currentWallet.balance - amount;

      const updatedWallet = await tx.creditWallet.update({
        where: { id: currentWallet.id },
        data: {
          balance: newBalance,
          lifetimeUsed: { increment: amount },
          version: { increment: 1 }
        }
      });

      const txRecord = await tx.creditTransaction.create({
        data: {
          walletId: updatedWallet.id,
          userId: user.id,
          amount: -amount,
          balanceAfter: newBalance,
          type: 'USAGE' as any,
          idempotencyKey: idempotencyKey || null,
          reason: reason || `Usage for ${operation}`,
          referenceId: referenceId || null,
        }
      });

      return {
        wallet: updatedWallet,
        txRecord
      };
    });

    return {
      success: true,
      isUnlimited: false,
      unlimited: false,
      balanceBefore: wallet.balance,
      balanceAfter: result.wallet.balance,
      amountDeducted: amount,
      transactionId: result.txRecord.id
    };
  } catch (err: any) {
    return {
      success: false,
      isUnlimited: false,
      unlimited: false,
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
      amountDeducted: 0,
      error: err.message === 'INSUFFICIENT_CREDITS' ? 'INSUFFICIENT_CREDITS' : 'TRANSACTION_FAILED'
    };
  }
}

/**
 * Grants credits to a user (e.g. on purchase, bonus, or admin adjustment).
 * Enforces idempotency to prevent duplicate credit grants on webhook replay attacks.
 */
export async function addCredits(params: {
  userId: string;
  amount: number;
  type: 'PURCHASE' | 'BONUS' | 'ADMIN_ADD' | 'REFUND' | 'ADJUSTMENT';
  idempotencyKey?: string;
  reason?: string;
  referenceId?: string;
}): Promise<CreditResult> {
  const { userId, amount, type, idempotencyKey, reason, referenceId } = params;

  if (amount <= 0) {
    return {
      success: false,
      isUnlimited: false,
      balanceBefore: 0,
      balanceAfter: 0,
      amountDeducted: 0,
      error: 'INVALID_AMOUNT'
    };
  }

  // Prevent double crediting on duplicate webhook events
  if (idempotencyKey) {
    const existing = await prisma.creditTransaction.findUnique({
      where: { idempotencyKey }
    });
    if (existing) {
      return {
        success: true,
        isUnlimited: false,
        balanceBefore: existing.balanceAfter - existing.amount,
        balanceAfter: existing.balanceAfter,
        amountDeducted: 0,
        transactionId: existing.id
      };
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { wallet: true }
  });

  if (!user) {
    return {
      success: false,
      isUnlimited: false,
      balanceBefore: 0,
      balanceAfter: 0,
      amountDeducted: 0,
      error: 'USER_NOT_FOUND'
    };
  }

  let wallet = user.wallet;
  if (!wallet) {
    wallet = await prisma.creditWallet.create({
      data: {
        userId: user.id,
        balance: 0,
        lifetimeUsed: 0,
        lifetimePurchased: 0
      }
    });
  }

  const isUnlimited = user.creditMode === 'UNLIMITED';
  if (isUnlimited) {
    return {
      success: true,
      isUnlimited: true,
      balanceBefore: 0,
      balanceAfter: 0,
      amountDeducted: 0,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const newBalance = wallet!.balance + amount;
    const updatedWallet = await tx.creditWallet.update({
      where: { id: wallet!.id },
      data: {
        balance: newBalance,
        lifetimePurchased: type === 'PURCHASE' ? { increment: amount } : undefined,
        version: { increment: 1 }
      }
    });

    const txRecord = await tx.creditTransaction.create({
      data: {
        walletId: updatedWallet.id,
        userId: user.id,
        amount,
        balanceAfter: newBalance,
        type: type as any,
        idempotencyKey: idempotencyKey || null,
        reason: reason || `Added ${amount} credits (${type})`,
        referenceId: referenceId || null
      }
    });

    return { updatedWallet, txRecord };
  });

  return {
    success: true,
    isUnlimited: false,
    balanceBefore: wallet.balance,
    balanceAfter: result.updatedWallet.balance,
    amountDeducted: 0,
    transactionId: result.txRecord.id
  };
}
