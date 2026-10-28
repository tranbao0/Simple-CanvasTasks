import { CanvasError } from './types';

export const MAX_RATE_LIMIT_RETRIES = 3;
export const BACKOFF_BASE_MS = 1_000;
/** A longer `Retry-After` means the request fails at once instead of holding a request slot. */
export const MAX_RETRY_AFTER_MS = 30_000;

export type Sleep = (ms: number) => Promise<void>;

export const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The wait before retry number `retry` (0 for the first retry): exponential backoff,
 * but never shorter than the server's `Retry-After`. Returns null when the server asks
 * for a wait longer than `MAX_RETRY_AFTER_MS`.
 */
export function rateLimitDelayMs(retry: number, retryAfterMs: number | undefined): number | null {
  if (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_AFTER_MS) return null;
  return Math.max(BACKOFF_BASE_MS * 2 ** retry, retryAfterMs ?? 0);
}

function isRateLimited(error: unknown): error is CanvasError {
  return error instanceof CanvasError && error.kind === 'rate_limited';
}

/** Runs `attempt`, and retries it up to 3 times when Canvas answers with a rate limit. Other errors fail at once. */
export async function withRateLimitRetry<T>(
  attempt: () => Promise<T>,
  wait: Sleep = sleep,
): Promise<T> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!isRateLimited(error) || retry >= MAX_RATE_LIMIT_RETRIES) throw error;
      const delay = rateLimitDelayMs(retry, error.retryAfterMs);
      if (delay === null) throw error;
      await wait(delay);
    }
  }
}
