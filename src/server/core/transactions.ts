import { redis } from '@devvit/web/server';

type Transaction = Awaited<ReturnType<typeof redis.watch>>;
type TransactionResult<T> = { commit: boolean; value: T };

// Read through redis after WATCH; queue writes through tx. A conflicting
// writer invalidates EXEC, so every retry must re-read the watched state.
export async function withTransaction<T>(
  keys: string[],
  prepare: (tx: Transaction) => Promise<TransactionResult<T>>
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const tx = await redis.watch(...keys);
    let closed = false;
    try {
      await tx.multi();
      const result = await prepare(tx);
      if (!result.commit) {
        await tx.discard();
        closed = true;
        return result.value;
      }
      const replies: unknown = await tx.exec();
      closed = true;
      if (Array.isArray(replies) && replies.length > 0 && replies[0] !== null) {
        return result.value;
      }
    } catch (error) {
      // Redis conflicts can also arrive as gRPC ABORTED (10), or as the
      // Redis transaction-failed error. Other failures must propagate.
      const conflict =
        (typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 10) ||
        (error instanceof Error &&
          error.message.includes('redis: transaction failed'));
      if (!conflict) throw error;
    } finally {
      if (!closed) {
        // Preserve the original error if the server already closed the tx.
        await tx.discard().catch(() => undefined);
      }
    }
  }
  throw new Error('Concurrent update prevented saving. Please try again.');
}
