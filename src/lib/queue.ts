// Run async jobs with at most `limit` in flight (PLAN 9.3: at most 4 SAM
// requests per visitor). Results keep input order; one failure does not stop
// the others, so partial part maps stay usable.

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export async function runLimited<T>(jobs: readonly (() => Promise<T>)[], limit: number,
  onSettled?: (index: number, result: Settled<T>) => void): Promise<Settled<T>[]> {
  if (limit < 1) throw new Error("limit must be at least 1");
  const results: Settled<T>[] = new Array(jobs.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const index = next++;
      try {
        results[index] = { ok: true, value: await jobs[index]!() };
      } catch (error) {
        results[index] = { ok: false, error };
      }
      onSettled?.(index, results[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}
