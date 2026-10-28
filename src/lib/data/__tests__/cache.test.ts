import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { emptyCache, sessionCacheItem, type SessionCache } from '../cache';
import { emptyCoverage } from '../coverage';

const ORIGIN = 'https://school.instructure.com';

function cacheWithData(): SessionCache {
  return {
    ...emptyCache(ORIGIN),
    planner: { ...emptyCoverage(), spans: [{ start: 1, end: 2, loadedAt: 3 }] },
    details: { '1': { id: '1' } as SessionCache['details'][string] },
    undated: { '101': [] },
    nextId: 7,
  };
}

beforeEach(() => fakeBrowser.reset());

describe('the stored cache', () => {
  it('keeps its heavy parts under their own keys and reads them back as one cache', async () => {
    const cache = cacheWithData();

    await sessionCacheItem.setValue(cache);

    const keys = Object.keys(await fakeBrowser.storage.session.get(null)).sort();
    expect(keys).toEqual([
      'weekrowAllAssignments',
      'weekrowCache',
      'weekrowDetails',
      'weekrowPlanner',
      'weekrowUndated',
    ]);
    expect(await sessionCacheItem.getValue()).toEqual(cache);
  });

  it('writes only the parts that changed since the last write', async () => {
    const cache = cacheWithData();
    await sessionCacheItem.setValue(cache);
    const set = vi.spyOn(browser.storage.session, 'set');

    await sessionCacheItem.setValue({
      ...cache,
      planner: emptyCoverage(),
      nextId: 8,
    });

    expect(set).toHaveBeenCalledTimes(1);
    expect(Object.keys(set.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      'weekrowCache',
      'weekrowPlanner',
    ]);
    expect((await sessionCacheItem.getValue())?.details).toEqual(cache.details);
  });

  it('removes every part', async () => {
    await sessionCacheItem.setValue(cacheWithData());

    await sessionCacheItem.setValue(null);

    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
    expect(await sessionCacheItem.getValue()).toBeNull();
  });

  it('fills a missing part with an empty one', async () => {
    await sessionCacheItem.setValue(cacheWithData());
    await fakeBrowser.storage.session.remove('weekrowDetails');

    expect((await sessionCacheItem.getValue())?.details).toEqual({});
  });
});
