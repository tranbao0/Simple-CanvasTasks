import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProbeResult } from '../../canvas/probe';
import { canvasOriginItem, offerItem } from '../../platform/storage';
import { setupStatusItem } from '../cache';
import {
  FROM_INPAGE,
  FROM_PANEL,
  ORIGIN,
  PANEL,
  createHarness,
  joinRanges,
  loadReady,
  rangeOf,
  useScenarioClock,
  type Harness,
} from '../testing/harness';

const CUSTOM = 'https://canvas.school.edu';
const OTHER_CUSTOM = 'https://lms.college.edu';
const INPAGE = { ...PANEL, surface: 'inpage' } as const;

/** A probe that answers only when the test says so. */
function heldProbe(h: Harness): (result: ProbeResult) => void {
  let answer: (result: ProbeResult) => void = () => undefined;
  h.probe.mockImplementation(
    () =>
      new Promise<ProbeResult>((resolve) => {
        answer = resolve;
      }),
  );
  return (result) => answer(result);
}

beforeEach(() => useScenarioClock());
afterEach(() => vi.useRealTimers());

describe('setup check', () => {
  it('shows checking, then saves a Canvas address, syncs the content script and loads', async () => {
    const h = await createHarness({ origin: null });
    let answer!: (result: ProbeResult) => void;
    h.probe.mockImplementation(
      () =>
        new Promise<ProbeResult>((resolve) => {
          answer = resolve;
        }),
    );

    await h.owner.setup(`${CUSTOM}/courses/5`, false);
    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'checking',
      origin: CUSTOM,
      savedOrigin: null,
    });
    expect(h.probe).toHaveBeenCalledWith(CUSTOM);

    answer('canvas');
    await h.owner.settled();

    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
    expect(h.syncContentScripts).toHaveBeenCalledTimes(1);
    expect(h.createApi).toHaveBeenCalledWith(CUSTOM);
    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });

  it('saves a Canvas address that needs a sign-in', async () => {
    const h = await createHarness({ origin: null });
    h.probe.mockResolvedValue('signed_out');

    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();

    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
  });

  it.each([
    ['redirects', { kind: 'redirects', origin: CUSTOM, savedOrigin: null }],
    ['not_canvas', { kind: 'not_canvas', origin: CUSTOM, savedOrigin: null }],
    ['network', { kind: 'unreachable', origin: CUSTOM, savedOrigin: null }],
  ] as const)('shows the %s result and saves nothing', async (result, state) => {
    const h = await createHarness({ origin: null });
    h.probe.mockResolvedValue(result);

    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toEqual(state);
    expect(await canvasOriginItem.getValue()).toBeNull();
    expect(h.syncContentScripts).not.toHaveBeenCalled();
  });

  it('rejects an address that is not a web origin without a request', async () => {
    const h = await createHarness({ origin: null });

    await h.owner.setup('10.0.0.1', false);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'not_canvas',
      origin: '10.0.0.1',
      savedOrigin: null,
    });
    expect(h.probe).not.toHaveBeenCalled();
    // The typed text stays for display only, so nothing can check it later.
    expect(await setupStatusItem.getValue()).toEqual({ kind: 'rejected', text: '10.0.0.1' });

    await h.owner.refresh('retry', FROM_PANEL);
    await h.owner.settled();
    expect(h.probe).not.toHaveBeenCalled();
  });

  it('checks a typed address again on Retry when it could not be reached', async () => {
    const h = await createHarness({ origin: null });
    h.probe.mockResolvedValueOnce('network').mockResolvedValueOnce('canvas');
    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();

    await h.owner.refresh('retry', FROM_PANEL);
    await h.owner.settled();

    expect(h.probe).toHaveBeenCalledTimes(2);
    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
  });

  it('never checks an address again for a Retry from a content script', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.probe.mockResolvedValue('network');
    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();
    h.probe.mockClear();
    h.canvas.resetCalls();

    // A content script that claims to be the panel is still a content script.
    await h.owner.refresh('retry', { surface: 'panel', fromExtensionPage: false });
    await h.owner.settled();

    expect(h.probe).not.toHaveBeenCalled();
    expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(1);
    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
  });

  it('refreshes the saved list for a Retry in the page while a check of another address failed', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.probe.mockResolvedValue('network');
    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();
    h.probe.mockClear();
    h.canvas.resetCalls();
    expect((await h.owner.getState(INPAGE)).kind).toBe('ready');

    await h.owner.refresh('retry', FROM_INPAGE);
    await h.owner.settled();

    expect(h.probe).not.toHaveBeenCalled();
    expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(1);
    expect((await h.owner.getState(PANEL)).kind).toBe('unreachable');
  });

  it('never checks a stored address that is not a usable https origin', async () => {
    const h = await createHarness({ origin: null });
    await setupStatusItem.setValue({ kind: 'checking', origin: 'http://10.0.0.1' });

    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(h.probe).not.toHaveBeenCalled();
    expect(await setupStatusItem.getValue()).toEqual({ kind: 'rejected', text: 'http://10.0.0.1' });
    expect(await canvasOriginItem.getValue()).toBeNull();
  });

  it('runs one full round after a check passes, with the origin watcher of the background', async () => {
    const h = await createHarness({ origin: null });
    const watched: Promise<void>[] = [];
    const stop = canvasOriginItem.watch((origin) => {
      watched.push(h.owner.originChanged(origin));
    });

    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();
    await Promise.all(watched);
    await h.owner.settled();
    stop();

    expect(watched.length).toBeGreaterThan(0);
    expect(h.canvas.callsOf('getProfile')).toHaveLength(1);
    // One round: the chunks of the current week's planner range, each asked for once.
    expect(joinRanges(h.canvas.plannerRanges())).toEqual([await rangeOf(h, 0)]);
    expect(h.canvas.callsOf('listUndatedAssignments')).toHaveLength(5);
  });

  it('clears the offer when the student accepts it', async () => {
    const h = await createHarness({ origin: null });
    await offerItem.setValue({ origin: CUSTOM, mode: 'use' });

    await h.owner.setup(CUSTOM, true);
    await h.owner.settled();

    expect(await offerItem.getValue()).toBeNull();
    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
  });

  it('switches to another Canvas and drops the old data', async () => {
    const h = await createHarness();
    await loadReady(h);

    await h.owner.setup(CUSTOM, true);
    await h.owner.settled();

    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
    expect(h.createApi).toHaveBeenLastCalledWith(CUSTOM);
    expect(await setupStatusItem.getValue()).toBeNull();
  });

  it('refreshes after access to the saved address is granted again', async () => {
    const h = await createHarness();
    h.hasAccess.mockResolvedValue(false);
    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'no_access',
      origin: ORIGIN,
      savedOrigin: null,
      offer: null,
    });

    h.hasAccess.mockResolvedValue(true);
    await h.owner.setup(ORIGIN, false);
    await h.owner.settled();

    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
    expect(h.syncContentScripts).toHaveBeenCalledTimes(1);
  });
  it('runs a check again that a stopped worker left unfinished', async () => {
    const h = await createHarness({ origin: null });
    await setupStatusItem.setValue({ kind: 'checking', origin: CUSTOM });

    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(h.probe).toHaveBeenCalledWith(CUSTOM);
    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
  });
});

describe('keeping the saved address', () => {
  it('names the saved address while another one is checked, and after the check fails', async () => {
    const h = await createHarness();
    await loadReady(h);
    let answer!: (result: ProbeResult) => void;
    h.probe.mockImplementation(
      () =>
        new Promise<ProbeResult>((resolve) => {
          answer = resolve;
        }),
    );

    await h.owner.setup(CUSTOM, true);
    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'checking',
      origin: CUSTOM,
      savedOrigin: ORIGIN,
    });

    answer('redirects');
    await h.owner.settled();
    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'redirects',
      origin: CUSTOM,
      savedOrigin: ORIGIN,
    });
    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
  });

  it('goes back to the list of the saved address after a failed check', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.probe.mockResolvedValue('not_canvas');
    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();

    await h.owner.act({ kind: 'keepSavedAddress' });
    await h.owner.settled();

    const state = await h.owner.getState(PANEL);
    expect(state.kind).toBe('ready');
    expect('origin' in state && state.origin).toBe(ORIGIN);
    expect(await setupStatusItem.getValue()).toBeNull();
    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
  });

  it('drops a running check, so its result never replaces the saved address', async () => {
    const h = await createHarness();
    await loadReady(h);
    let answer!: (result: ProbeResult) => void;
    h.probe.mockImplementation(
      () =>
        new Promise<ProbeResult>((resolve) => {
          answer = resolve;
        }),
    );
    await h.owner.setup(CUSTOM, false);

    await h.owner.act({ kind: 'keepSavedAddress' });
    answer('canvas');
    await h.owner.settled();

    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });

  it('does nothing when no address is saved', async () => {
    const h = await createHarness({ origin: null });
    h.probe.mockResolvedValue('not_canvas');
    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();

    await h.owner.act({ kind: 'keepSavedAddress' });

    expect((await h.owner.getState(PANEL)).kind).toBe('not_canvas');
  });

  it('keeps showing the list in a Canvas page while the panel checks another address', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.probe.mockResolvedValue('not_canvas');
    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();

    const inpage = await h.owner.getState({ ...PANEL, surface: 'inpage' });
    expect(inpage.kind).toBe('ready');
    expect((await h.owner.getState(PANEL)).kind).toBe('not_canvas');
  });
});

describe('change address', () => {
  it('opens the form but keeps the saved address, with a way back to it', async () => {
    const h = await createHarness();
    await loadReady(h);

    await h.owner.changeAddress();
    await h.owner.settled();

    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
    expect(h.syncContentScripts).not.toHaveBeenCalled();
    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'not_set_up',
      offer: null,
      savedOrigin: ORIGIN,
    });
    // The list in a Canvas page of the saved address stays.
    expect((await h.owner.getState(INPAGE)).kind).toBe('ready');

    await h.owner.act({ kind: 'keepSavedAddress' });
    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });

  it('replaces the saved address only after a new one passes the check', async () => {
    const h = await createHarness();
    await loadReady(h);
    await h.owner.changeAddress();

    h.probe.mockResolvedValueOnce('not_canvas');
    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();
    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'not_canvas',
      origin: CUSTOM,
      savedOrigin: ORIGIN,
    });

    h.probe.mockResolvedValueOnce('canvas');
    await h.owner.setup(OTHER_CUSTOM, false);
    await h.owner.settled();
    expect(await canvasOriginItem.getValue()).toBe(OTHER_CUSTOM);
  });

  it('shows the plain form when no address is saved', async () => {
    const h = await createHarness({ origin: null });

    await h.owner.changeAddress();

    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'not_set_up',
      offer: null,
      savedOrigin: null,
    });
  });

  it('follows an address that the background saved for a content script', async () => {
    const h = await createHarness({ origin: null });
    expect((await h.owner.getState(PANEL)).kind).toBe('not_set_up');

    await canvasOriginItem.setValue(ORIGIN);
    expect(await h.owner.getState(PANEL)).toEqual({ kind: 'loading' });
    await h.owner.settled();

    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });
});

describe('a Canvas page found by a content script', () => {
  it('saves an instructure.com address when none is saved', async () => {
    const h = await createHarness({ origin: null });

    expect(await h.owner.canvasDetected(ORIGIN)).toBe(ORIGIN);
    await h.owner.settled();

    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });

  it.each([
    ['a saved address', ORIGIN, 'https://other.instructure.com'],
    ['a test host', null, 'https://school.test.instructure.com'],
    ['a beta host', null, 'https://school.beta.instructure.com'],
    ['a custom domain', null, CUSTOM],
    ['an http origin', null, 'http://school.instructure.com'],
  ] as const)('saves nothing with %s', async (_name, saved, page) => {
    const h = await createHarness({ origin: saved });

    expect(await h.owner.canvasDetected(page)).toBe(saved);

    expect(await canvasOriginItem.getValue()).toBe(saved);
  });
});

describe('optional site access', () => {
  it.each(['not_canvas', 'redirects'] as const)(
    'removes the grant of an address whose check ends as %s',
    async (result) => {
      const h = await createHarness({ origin: null });
      h.probe.mockResolvedValue(result);

      await h.owner.setup(CUSTOM, false);
      await h.owner.settled();

      expect(h.removeAccess).toHaveBeenCalledWith(CUSTOM);
    },
  );

  it('keeps the grant of an unreachable address for Retry, and removes it on Keep using', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.probe.mockResolvedValue('network');
    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();
    expect(h.removeAccess).not.toHaveBeenCalled();

    await h.owner.act({ kind: 'keepSavedAddress' });

    expect(h.removeAccess).toHaveBeenCalledWith(CUSTOM);
  });

  it('removes the grant of a custom address that another one replaced', async () => {
    const h = await createHarness({ origin: CUSTOM });
    await loadReady(h);

    await h.owner.setup(OTHER_CUSTOM, false);
    await h.owner.settled();

    expect(await canvasOriginItem.getValue()).toBe(OTHER_CUSTOM);
    expect(h.removeAccess).toHaveBeenCalledWith(CUSTOM);
    expect(h.removeAccess).not.toHaveBeenCalledWith(OTHER_CUSTOM);
  });

  it('never removes an instructure.com grant or the saved address', async () => {
    const h = await createHarness({ origin: CUSTOM });
    await loadReady(h);
    h.probe.mockResolvedValueOnce('not_canvas').mockResolvedValueOnce('canvas');

    await h.owner.setup('https://other.instructure.com', false);
    await h.owner.settled();
    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();

    expect(h.removeAccess).not.toHaveBeenCalled();
  });

  it('keeps the grant while a new check of the same address runs', async () => {
    const h = await createHarness({ origin: null });
    h.probe.mockResolvedValueOnce('network');
    await h.owner.setup(CUSTOM, false);
    await h.owner.settled();
    const answer = heldProbe(h);

    await h.owner.refresh('retry', FROM_PANEL);
    expect(h.removeAccess).not.toHaveBeenCalled();
    answer('canvas');
    await h.owner.settled();

    expect(h.removeAccess).not.toHaveBeenCalled();
    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
  });
});
