/**
 * Re-runs a whole transaction when it lost a race on a unique index (Prisma P2002). The retry sees the
 * winner's committed rows, so idempotent operations converge instead of failing. Any other error,
 * and a P2002 that persists, is rethrown.
 */
export async function retryOnUniqueViolation<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002' && attempt < retries) continue;
      throw err;
    }
  }
}
