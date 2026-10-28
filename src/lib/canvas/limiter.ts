export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** Runs at most `maxConcurrency` tasks at once. Waiting tasks start in the order they arrived. */
export function createLimiter(maxConcurrency: number): Limiter {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError(`maxConcurrency must be a positive integer, got ${maxConcurrency}`);
  }
  let running = 0;
  const waiting: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (running < maxConcurrency) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };

  /** Hands the slot to the next waiting task, or frees it. */
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };

  return async (task) => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}
