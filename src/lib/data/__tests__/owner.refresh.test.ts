import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plannerRangeFor } from '../../model';
import { changeMarkerItem, settingsItem } from '../../platform/storage';
import { IDS } from '../../../../tests/fixtures/scenario';
import { sessionCacheItem, type SessionCache } from '../cache';
import { REFRESH_LIMIT_MS, TIMER_FULL_AFTER_MS } from '../policy';
import { canvasError, type FakeMethod } from '../testing/fakeCanvas';
import {
  FROM_PANEL,
  PANEL,
  advance,
  createHarness,
  expectReady,
  loadReady,
  type Harness,
  useScenarioClock,
} from '../testing/harness';

beforeEach(() => useScenarioClock());
afterEach(() => vi.useRealTimers());

/** A light round asks for the planner items, and for the user in parallel. */
const LIGHT: FakeMethod[] = ['getSelf', 'listPlannerItems'];
const FULL_EXTRA: FakeMethod[] = [
  'listAssignmentsByIds',
  'listUndatedAssignments',
  'listPlannerOverrides',
];

function methods(h: Harness): Set<FakeMethod> {
  return new Set(h.canvas.calls.map((call) => call.method));
}

async function loaded(): Promise<Harness> {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.resetCalls();
  return h;
}

/** The planner range of a week of the scenario at the current fake time. */
async function rangeOf(h: Harness, weekOffset: number) {
  return plannerRangeFor({
    now: new Date(Date.now()).toISOString(),
    profile: h.canvas.scenario.profile,
    settings: await settingsItem.getValue(),
    browserTimeZone: h.canvas.scenario.timeZone,
    browserLanguage: 'en-US',
    weekOffset,
    courses: h.canvas.scenario.courses,
  });
}

describe('light and full rounds', () => {
  it('refreshes only the planner items, with the user check, after a Canvas page load', async () => {
    const h = await loaded();
    await advance(h, 61_000);

    await h.owner.pageLoaded(h.canvas.scenario.origin);
    await h.owner.settled();

    expect([...methods(h)]).toEqual(LIGHT);
  });

  it('ignores a page load from another origin', async () => {
    const h = await loaded();
    await advance(h, 61_000);

    await h.owner.pageLoaded('https://other.instructure.com');
    await h.owner.settled();

    expect(h.canvas.calls).toEqual([]);
  });

  it('refreshes the planner items when a window gains focus', async () => {
    const h = await loaded();
    await advance(h, 61_000);

    await h.owner.trigger('focus');
    await h.owner.settled();

    expect([...methods(h)]).toEqual(LIGHT);
  });

  it('refreshes everything on the 5-minute timer, but the session data only once', async () => {
    const h = await loaded();
    await advance(h, 5 * 60_000);

    await h.owner.refresh('timer', FROM_PANEL);
    await h.owner.settled();

    expect([...methods(h)].sort()).toEqual([...LIGHT, ...FULL_EXTRA].sort());
    expect(h.canvas.callsOf('listUndatedAssignments')).toHaveLength(5);
    expect(h.canvas.callsOf('getProfile')).toHaveLength(0);
    expect(h.canvas.callsOf('listCustomGradeStatuses')).toHaveLength(0);
  });

  it('asks for a full round when a surface becomes visible after 5 minutes, else a light one', async () => {
    const h = await loaded();
    await advance(h, 2 * 60_000);

    await h.owner.refresh('visible', FROM_PANEL);
    await h.owner.settled();
    expect([...methods(h)]).toEqual(LIGHT);

    h.canvas.resetCalls();
    await advance(h, 4 * 60_000);
    await h.owner.refresh('visible', FROM_PANEL);
    await h.owner.settled();
    expect([...methods(h)].sort()).toEqual([...LIGHT, ...FULL_EXTRA].sort());
  });
  it('refreshes the current week and the recently shown weeks with one planner request', async () => {
    const h = await loaded();
    for (let offset = 1; offset <= 6; offset += 1) {
      await h.owner.getState({ ...PANEL, weekOffset: offset });
      await h.owner.settled();
    }
    await advance(h, 61_000);
    h.canvas.resetCalls();

    await h.owner.trigger('focus');
    await h.owner.settled();

    const current = await rangeOf(h, 0);
    const latest = await rangeOf(h, 6);
    expect(h.canvas.callsOf('listPlannerItems')).toEqual([
      [{ start: current.start, end: latest.end }],
    ]);
    // Every shown week reads from that one entry, so no view asks Canvas again.
    h.canvas.resetCalls();
    for (let offset = 0; offset <= 6; offset += 1) {
      expect(expectReady(await h.owner.getState({ ...PANEL, weekOffset: offset })).refreshing).toBe(
        false,
      );
    }
    await h.owner.settled();
    expect(h.canvas.calls).toEqual([]);
  });

  it('keeps one planner entry for the views it covers', async () => {
    const h = await loaded();
    await h.owner.getState({ ...PANEL, weekOffset: 1 });
    await h.owner.settled();
    await advance(h, 61_000);

    await h.owner.trigger('focus');
    await h.owner.settled();

    const cache = (await sessionCacheItem.getValue()) as SessionCache;
    expect(Object.keys(cache.planner)).toHaveLength(1);
  });
});

describe('the 60-second limit', () => {
  it('runs one round for ten page loads in ten seconds', async () => {
    const h = await loaded();
    await advance(h, 61_000);

    for (let index = 0; index < 10; index += 1) {
      await h.owner.pageLoaded(h.canvas.scenario.origin);
      await advance(h, 1000);
    }

    expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(1);
  });

  it('skips a light round within 60 seconds of the first load', async () => {
    const h = await loaded();
    await advance(h, 30_000);

    await h.owner.trigger('focus');
    await h.owner.settled();

    expect(h.canvas.calls).toEqual([]);
  });

  it('runs a full request that comes after a light round when the 60 seconds end', async () => {
    const h = await loaded();
    await advance(h, TIMER_FULL_AFTER_MS);
    await h.owner.trigger('focus');
    await h.owner.settled();
    const lightAt = Date.now();
    h.canvas.resetCalls();

    await advance(h, 10_000);
    const result = await h.owner.refresh('timer', FROM_PANEL);
    await h.owner.settled();
    expect(h.canvas.calls).toEqual([]);
    // The surfaces learn when to ask again, because a stopped worker loses its own timer.
    expect(result).toEqual({ retryAt: lightAt + REFRESH_LIMIT_MS });

    await advance(h, 50_000);
    expect([...methods(h)].sort()).toEqual([...LIGHT, ...FULL_EXTRA].sort());
  });

  it('runs the put-off full round once when a surface asks again at that time', async () => {
    const h = await loaded();
    await advance(h, TIMER_FULL_AFTER_MS);
    await h.owner.trigger('focus');
    await h.owner.settled();
    await advance(h, 10_000);
    const { retryAt } = await h.owner.refresh('timer', FROM_PANEL);
    h.canvas.resetCalls();

    // A surface timer asks first; the background timer then finds the round done.
    await advance(h, (retryAt ?? 0) - Date.now() - 1);
    vi.setSystemTime(retryAt ?? 0);
    await h.owner.refresh('timer', FROM_PANEL);
    await advance(h, 10_000);

    expect(h.canvas.callsOf('listUndatedAssignments')).toHaveLength(5);
    expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(1);
  });

  it('shares one full round between the timers of several surfaces', async () => {
    const h = await loaded();
    await advance(h, 5 * 60_000);
    await h.owner.refresh('timer', FROM_PANEL);
    await h.owner.settled();
    h.canvas.resetCalls();

    // Another surface's timer ticks two minutes later.
    await advance(h, 2 * 60_000);
    expect(await h.owner.refresh('timer', FROM_PANEL)).toEqual({ retryAt: null });
    await h.owner.settled();
    expect(h.canvas.calls).toEqual([]);

    await advance(h, TIMER_FULL_AFTER_MS - 2 * 60_000);
    await h.owner.refresh('timer', FROM_PANEL);
    await h.owner.settled();
    expect(h.canvas.callsOf('listUndatedAssignments')).toHaveLength(5);
  });

  it('drops a full request within 60 seconds of a full round', async () => {
    const h = await loaded();
    await advance(h, 20_000);

    await h.owner.refresh('timer', FROM_PANEL);
    await advance(h, 120_000);

    expect(h.canvas.calls).toEqual([]);
  });

  it('lets Retry skip the limit', async () => {
    const h = await loaded();
    await advance(h, 5000);

    await h.owner.refresh('retry', FROM_PANEL);
    await h.owner.settled();

    expect([...methods(h)].sort()).toEqual([...LIGHT, ...FULL_EXTRA].sort());
  });

  it('lets a write skip the limit and then refreshes everything', async () => {
    const h = await loaded();
    await advance(h, 5000);

    await h.owner.act({
      kind: 'setDone',
      key: `assignment:${IDS.assignments.bioQuiz3Today}`,
      done: true,
    });
    await h.owner.settled();

    expect(h.canvas.callsOf('createOverride')).toHaveLength(1);
    expect(h.canvas.callsOf('listUndatedAssignments')).toHaveLength(5);
  });

  it('lets a page load after a sign-out check the sign-in at once', async () => {
    const h = await loaded();
    await advance(h, 61_000);
    h.canvas.fail('listPlannerItems', canvasError('unauthorized', 401), { times: 1 });
    // The round's user check and the sign-in check both see the sign-out.
    h.canvas.fail('getSelf', canvasError('unauthorized', 401), { times: 2 });
    await h.owner.trigger('focus');
    await h.owner.settled();
    expect((await h.owner.getState(PANEL)).kind).toBe('signed_out');
    h.canvas.resetCalls();

    await advance(h, 5000);
    await h.owner.pageLoaded(h.canvas.scenario.origin);
    await h.owner.settled();

    expect(h.canvas.callsOf('getProfile')).toHaveLength(1);
    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });
});

describe('midnight, settings and address changes', () => {
  /** Saturday 00:00:01 in New York: the Tomorrow look-ahead now reaches into the next week. */
  const SATURDAY = Date.parse('2026-10-31T04:00:01Z');

  it('loads the planner items of a range that grew after midnight in the Canvas time zone', async () => {
    const h = await loaded();
    expect(h.canvas.scenario.now).toBe('2026-10-27T18:00:00.000Z');

    vi.setSystemTime(SATURDAY);
    await h.owner.refresh('midnight', FROM_PANEL);
    await h.owner.settled();

    expect(h.canvas.callsOf('listPlannerItems')).toEqual([[await rangeOf(h, 0)]]);
    const state = expectReady(await h.owner.getState(PANEL));
    expect(state.view.today).toBe('2026-10-31');
  });

  it('needs no request after a midnight that the cached range still covers', async () => {
    const h = await loaded();

    vi.setSystemTime(Date.parse('2026-10-28T04:00:01Z'));
    await h.owner.refresh('midnight', FROM_PANEL);
    await h.owner.settled();

    expect(h.canvas.calls).toEqual([]);
    const state = expectReady(await h.owner.getState(PANEL));
    expect(state.view.today).toBe('2026-10-28');
    expect(state.refreshing).toBe(false);
  });

  it('shows the list from the old range while the new range loads', async () => {
    const h = await loaded();
    vi.setSystemTime(SATURDAY);
    const release = h.canvas.hold('listPlannerItems');

    const state = expectReady(await h.owner.getState(PANEL));

    expect(state.refreshing).toBe(true);
    expect(state.view.today).toBe('2026-10-31');
    release();
    await h.owner.settled();
    expect(expectReady(await h.owner.getState(PANEL)).refreshing).toBe(false);
  });

  it('loads what a settings change needs and tells the surfaces', async () => {
    const h = await loaded();
    const marker = await changeMarkerItem.getValue();
    await settingsItem.setValue({ ...(await settingsItem.getValue()), hiddenCourseIds: [] });

    await h.owner.refresh('settings', FROM_PANEL);
    await h.owner.settled();

    expect(await changeMarkerItem.getValue()).toBeGreaterThan(marker);
    expect(h.canvas.callsOf('listUndatedAssignments')).toEqual([[IDS.courses.club]]);
  });

  it('drops the old data and loads the new Canvas at once after an address change', async () => {
    const h = await loaded();
    await advance(h, 5000);

    await h.owner.originChanged('https://other.instructure.com');
    await h.owner.settled();

    expect(h.createApi).toHaveBeenLastCalledWith('https://other.instructure.com');
    expect(h.canvas.callsOf('getProfile')).toHaveLength(1);
  });

  it('writes a new change marker after every round', async () => {
    const h = await loaded();
    const first = await changeMarkerItem.getValue();
    await advance(h, 61_000);

    await h.owner.trigger('focus');
    await h.owner.settled();

    expect(await changeMarkerItem.getValue()).toBeGreaterThan(first);
  });
});
