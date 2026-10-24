/** Bound extension hooks even when their implementation ignores cancellation. */
export async function bounded<T>(operation: () => T | Promise<T>, timeoutMs: number, label: string, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => { signal?.throwIfAborted(); return operation(); }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
        abort = () => reject(signal?.reason ?? new Error('Cancelled'));
        signal?.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

export interface RunUsage {
  inferenceCalls: number;
  wallClockMs: number;
  /** Null means pricing is unknown; never pretend unpriced live calls were free. */
  inferenceUsd: number | null;
  costBasis: 'configured-per-call-estimate' | 'mock' | 'unknown';
}
