import { describe, expect, it } from 'vitest';
import { createLimiter } from '../limiter';
import { deferred, settle, type Deferred } from './support';

describe('createLimiter', () => {
  it('runs at most the limit at once and starts waiting tasks in order', async () => {
    const limit = createLimiter(2);
    const gates: Array<Deferred<void>> = [];
    const started: number[] = [];
    let running = 0;
    let maxRunning = 0;

    const results = Array.from({ length: 5 }, (_, index) =>
      limit(async () => {
        started.push(index);
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        const gate = deferred();
        gates.push(gate);
        await gate.promise;
        running -= 1;
        return index;
      }),
    );

    await settle();
    expect(started).toEqual([0, 1]);

    gates[1]?.resolve();
    await settle();
    expect(started).toEqual([0, 1, 2]);

    for (let index = 0; index < 5; index += 1) {
      gates[index]?.resolve();
      await settle();
    }
    await expect(Promise.all(results)).resolves.toEqual([0, 1, 2, 3, 4]);
    expect(maxRunning).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it('frees the slot when a task fails', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limit(() => Promise.resolve('next'))).resolves.toBe('next');
  });

  it('rejects a limit that is not a positive integer', () => {
    expect(() => createLimiter(0)).toThrow(RangeError);
    expect(() => createLimiter(1.5)).toThrow(RangeError);
    expect(() => createLimiter(Number.NaN)).toThrow(RangeError);
  });
});
