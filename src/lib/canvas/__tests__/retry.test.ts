import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RETRY_AFTER_MS, rateLimitDelayMs, withRateLimitRetry } from '../retry';
import { CanvasError } from '../types';
import { catchError, settle, useRetryFakeTimers } from './support';

function rateLimited(retryAfterMs?: number): CanvasError {
  return new CanvasError('rate_limited', 'slow down', 429, retryAfterMs);
}

describe('rateLimitDelayMs', () => {
  it('doubles from one second', () => {
    expect([0, 1, 2].map((retry) => rateLimitDelayMs(retry, undefined))).toEqual([
      1000, 2000, 4000,
    ]);
  });

  it('never waits less than Retry-After', () => {
    expect(rateLimitDelayMs(0, 5000)).toBe(5000);
    expect(rateLimitDelayMs(2, 1000)).toBe(4000);
    expect(rateLimitDelayMs(0, 0)).toBe(1000);
  });

  it('gives up when Retry-After is too long', () => {
    expect(rateLimitDelayMs(0, MAX_RETRY_AFTER_MS)).toBe(MAX_RETRY_AFTER_MS);
    expect(rateLimitDelayMs(0, MAX_RETRY_AFTER_MS + 1)).toBeNull();
  });
});

describe('withRateLimitRetry', () => {
  beforeEach(() => useRetryFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries with exponential backoff, then returns the result', async () => {
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(rateLimited())
      .mockResolvedValueOnce('done');

    const result = withRateLimitRetry(attempt);
    await settle();
    expect(attempt).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(3);

    await expect(result).resolves.toBe('done');
  });

  it('stops after 3 retries and throws the last rate limit error', async () => {
    const last = rateLimited();
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(last);

    const error = catchError(withRateLimitRetry(attempt));
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    expect(await error).toBe(last);
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it('waits for Retry-After when it is longer than the backoff', async () => {
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimited(5000))
      .mockResolvedValueOnce('done');

    const result = withRateLimitRetry(attempt);
    await vi.advanceTimersByTimeAsync(4999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('done');
  });

  it('fails at once when Retry-After is longer than the limit', async () => {
    const error = rateLimited(MAX_RETRY_AFTER_MS + 1000);
    const attempt = vi.fn<() => Promise<string>>().mockRejectedValue(error);
    await expect(withRateLimitRetry(attempt)).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it.each(['server', 'network', 'unauthorized', 'forbidden', 'bad_request'] as const)(
    'does not retry a %s error',
    async (kind) => {
      const error = new CanvasError(kind, kind);
      const attempt = vi.fn<() => Promise<string>>().mockRejectedValue(error);
      await expect(withRateLimitRetry(attempt)).rejects.toBe(error);
      expect(attempt).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry an error that is not a CanvasError', async () => {
    const attempt = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('bug'));
    await expect(withRateLimitRetry(attempt)).rejects.toThrow('bug');
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
