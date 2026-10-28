import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { plannerRangeFor, type ModelInput } from '../../model';
import { offerItem, settingsItem } from '../../platform/storage';
import { IDS, buildScenario } from '../../../../tests/fixtures/scenario';
import { canvasError } from '../testing/fakeCanvas';
import {
  FROM_PANEL,
  ORIGIN,
  PANEL,
  advance,
  createHarness,
  expectReady,
  findItem,
  loadReady,
  useScenarioClock,
  viewItems,
} from '../testing/harness';

const C = IDS.courses;
const VISIBLE_COURSES = [C.biology, C.calculus, C.history, C.chemistry, C.orientation];

beforeEach(() => useScenarioClock());
afterEach(() => vi.useRealTimers());

describe('first load', () => {
  it('shows loading, then loads every piece of data once and shows the week', async () => {
    const h = await createHarness();

    expect(await h.owner.getState(PANEL)).toEqual({ kind: 'loading' });
    await h.owner.settled();
    const state = expectReady(await h.owner.getState(PANEL));

    for (const method of [
      'getProfile',
      'listCourses',
      'listGroups',
      'getColors',
      'getDashboardPositions',
      'listPlannerOverrides',
    ] as const) {
      expect(h.canvas.callsOf(method), method).toHaveLength(1);
    }
    const settings = await settingsItem.getValue();
    const input: Pick<
      ModelInput,
      'now' | 'profile' | 'settings' | 'browserTimeZone' | 'weekOffset' | 'courses'
    > = {
      now: new Date(Date.now()).toISOString(),
      profile: h.canvas.scenario.profile,
      settings,
      browserTimeZone: h.canvas.scenario.timeZone,
      weekOffset: 0,
      courses: h.canvas.scenario.courses,
    };
    expect(h.canvas.callsOf('listPlannerItems')).toEqual([[plannerRangeFor(input)]]);
    expect(h.canvas.callsOf('listUndatedAssignments').map(([id]) => id)).toEqual(VISIBLE_COURSES);
    expect(h.canvas.callsOf('listAssignmentsByIds').map(([id]) => id)).toEqual(VISIBLE_COURSES);
    expect(h.canvas.callsOf('listAssignmentsByIds')).toContainEqual([
      C.biology,
      expect.arrayContaining([IDS.assignments.bioQuiz3Today, IDS.assignments.bioLabReport4]),
    ]);
    // Only history has a teacher status in the scenario.
    expect(h.canvas.callsOf('listCustomGradeStatuses')).toEqual([[[C.history]]]);
    expect(h.canvas.callsOf('getSelf')).toHaveLength(0);

    expect(state).toMatchObject({
      origin: ORIGIN,
      stale: null,
      refreshing: false,
      offer: null,
      undo: null,
      seenNotes: { firstDone: false, firstSkip: false },
    });
    expect(state.view.isCurrentWeek).toBe(true);
    expect(state.view.groups.map((group) => group.kind)).toEqual([
      'past_due',
      'today',
      'tomorrow',
      'day',
      'day',
      'no_due_date',
      'done',
    ]);
    expect(findItem(state, `assignment:${IDS.assignments.bioQuiz3Today}`)).toMatchObject({
      title: 'Quiz 3: Cell membranes',
      state: 'open',
      handIn: 'canvas',
    });
    expect(state.taskCourses.map((course) => course.id)).not.toContain(C.club);
    expect(state.view.hiddenCourseCount).toBe(1);
  });

  it('asks Canvas nothing more while the view is complete', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.resetCalls();

    await h.owner.getState(PANEL);
    await h.owner.getState({ ...PANEL, courseFilter: C.biology });
    await h.owner.settled();

    expect(h.canvas.calls).toEqual([]);
  });

  it('loads the planner range of another week when a surface shows it', async () => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.resetCalls();

    expect(await h.owner.getState({ ...PANEL, weekOffset: 1 })).toEqual({ kind: 'loading' });
    await h.owner.settled();
    const next = expectReady(await h.owner.getState({ ...PANEL, weekOffset: 1 }));

    expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(1);
    expect(h.canvas.callsOf('getProfile')).toHaveLength(0);
    expect(next.view.weekOffset).toBe(1);
    expect(next.view.weekStart).toBe('2026-11-01');
  });

  it('keeps Canvas data in storage.session and only allowed keys in storage.local', async () => {
    const h = await createHarness();
    await loadReady(h);

    const local = await fakeBrowser.storage.local.get(null);
    expect(Object.keys(local).sort()).toEqual(['canvasOrigin', 'changeMarker', 'settings']);
    const session = await fakeBrowser.storage.session.get(null);
    expect(Object.keys(session)).toContain('weekrowCache');
  });

  it('shows the cached list after a service worker restart without asking Canvas', async () => {
    const h = await createHarness();
    const before = await loadReady(h);
    h.canvas.resetCalls();

    const restarted = h.restart();
    const after = expectReady(await restarted.getState(PANEL));
    await restarted.settled();

    expect(after.view).toEqual(before.view);
    expect(h.canvas.calls).toEqual([]);
  });

  it('builds a scoped view for a course home page', async () => {
    const h = await createHarness();
    const state = await loadReady(h, {
      surface: 'inpage',
      weekOffset: 0,
      scopeCourseId: C.biology,
    });

    expect(viewItems(state.view).every((item) => item.courseId === C.biology)).toBe(true);
    expect(state.view.scopeCourseId).toBe(C.biology);
    expect(state.view.scopeCourseHidden).toBe(false);
  });

  it('marks the home page of a hidden course', async () => {
    const h = await createHarness();
    const state = await loadReady(h, { surface: 'inpage', weekOffset: 0, scopeCourseId: C.club });

    expect(state.view.scopeCourseHidden).toBe(true);
  });
});

describe('states', () => {
  it('shows the first-run steps when no address is saved', async () => {
    const h = await createHarness({ origin: null });
    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'not_set_up',
      offer: null,
      savedOrigin: null,
    });

    await offerItem.setValue({ origin: 'https://state.instructure.com', mode: 'use' });
    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'not_set_up',
      offer: { origin: 'https://state.instructure.com', mode: 'use' },
      savedOrigin: null,
    });
    // The welcome page has its own form, so only the panel shows the offer.
    expect(await h.owner.getState({ ...PANEL, surface: 'page' })).toEqual({
      kind: 'not_set_up',
      offer: null,
      savedOrigin: null,
    });
    expect(h.canvas.calls).toEqual([]);
  });

  it('ignores an offer for the saved address', async () => {
    const h = await createHarness();
    await offerItem.setValue({ origin: ORIGIN, mode: 'switch' });
    expect((await loadReady(h)).offer).toBeNull();

    await offerItem.setValue({ origin: 'https://other.instructure.com', mode: 'switch' });
    expect(expectReady(await h.owner.getState(PANEL)).offer).toEqual({
      origin: 'https://other.instructure.com',
      mode: 'switch',
    });
  });

  it('never shows the offer in the in-page list, which lives on the saved Canvas page', async () => {
    const h = await createHarness();
    await loadReady(h);
    await offerItem.setValue({ origin: 'https://other.instructure.com', mode: 'switch' });

    expect(expectReady(await h.owner.getState({ ...PANEL, surface: 'inpage' })).offer).toBeNull();
  });

  it('offers the switch in the panel while the saved address shows no list', async () => {
    const offer = { origin: 'https://other.instructure.com', mode: 'switch' } as const;
    const signedOut = await createHarness();
    await offerItem.setValue(offer);
    signedOut.canvas.fail('getProfile', canvasError('unauthorized', 401));
    signedOut.canvas.fail('getSelf', canvasError('unauthorized', 401));
    await signedOut.owner.getState(PANEL);
    await signedOut.owner.settled();

    expect(await signedOut.owner.getState(PANEL)).toMatchObject({ kind: 'signed_out', offer });
    expect(await signedOut.owner.getState({ ...PANEL, surface: 'inpage' })).toMatchObject({
      kind: 'signed_out',
      offer: null,
    });

    const noAccess = await createHarness({ access: false });
    await offerItem.setValue(offer);
    expect(await noAccess.owner.getState(PANEL)).toMatchObject({ kind: 'no_access', offer });

    const scenario = buildScenario(new Date(Date.now()).toISOString());
    scenario.courses = [];
    const noCourses = await createHarness({ scenario });
    await offerItem.setValue(offer);
    await noCourses.owner.getState(PANEL);
    await noCourses.owner.settled();
    expect(await noCourses.owner.getState(PANEL)).toMatchObject({ kind: 'no_courses', offer });

    const cantLoad = await createHarness();
    await offerItem.setValue(offer);
    cantLoad.canvas.fail('listCourses', canvasError('server', 500), { times: 1 });
    await cantLoad.owner.getState(PANEL);
    await cantLoad.owner.settled();
    expect(await cantLoad.owner.getState(PANEL)).toMatchObject({ kind: 'cant_load', offer });
  });

  it('asks for access when the host permission is missing', async () => {
    const h = await createHarness({ access: false });
    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'no_access',
      origin: ORIGIN,
      savedOrigin: null,
      offer: null,
    });
    await h.owner.settled();
    expect(h.canvas.calls).toEqual([]);
  });

  it('shows signed out when a 401 is confirmed by GET users/self', async () => {
    const h = await createHarness();
    h.canvas.fail('getProfile', canvasError('unauthorized', 401));
    h.canvas.fail('getSelf', canvasError('unauthorized', 401));

    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'signed_out',
      origin: ORIGIN,
      isFirefox: false,
      offer: null,
    });
    expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
  });

  it('tells Firefox users about private windows when signed out', async () => {
    const h = await createHarness({ isFirefox: true });
    h.canvas.fail('listPlannerItems', canvasError('unauthorized', 401));
    h.canvas.fail('getSelf', canvasError('unauthorized', 401));

    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toMatchObject({ kind: 'signed_out', isFirefox: true });
  });

  it('forgets the cached list when the student signs out', async () => {
    const h = await createHarness();
    await loadReady(h);
    await vi.advanceTimersByTimeAsync(61_000);
    h.canvas.fail('listPlannerItems', canvasError('unauthorized', 401));
    h.canvas.fail('getSelf', canvasError('unauthorized', 401));

    await h.owner.trigger('focus');
    await h.owner.settled();

    expect((await h.owner.getState(PANEL)).kind).toBe('signed_out');
    const session = (await fakeBrowser.storage.session.get('weekrowCache'))['weekrowCache'];
    expect(session).toMatchObject({ session: null, planner: {}, details: {} });
  });

  it("shows can't load when a 401 is not confirmed and nothing is cached", async () => {
    const h = await createHarness();
    h.canvas.fail('getProfile', canvasError('unauthorized', 401), { times: 1 });

    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'cant_load',
      origin: ORIGIN,
      offline: false,
      savedOrigin: null,
      offer: null,
    });
  });

  it('builds the list from all assignments when the school limits the planner', async () => {
    const h = await createHarness();
    h.canvas.fail('listPlannerItems', canvasError('forbidden', 403));

    const state = await loadReady(h);

    expect(state.view.limited).toBe(true);
    expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
    expect(h.canvas.callsOf('listAllAssignments').map(([id]) => id)).toEqual(VISIBLE_COURSES);
    expect(h.canvas.callsOf('listPlannerOverrides')).toHaveLength(1);
    expect(h.canvas.callsOf('listUndatedAssignments')).toHaveLength(0);
    expect(h.canvas.callsOf('listAssignmentsByIds')).toHaveLength(0);
    const kinds = new Set(viewItems(state.view).map((item) => item.kind));
    expect(kinds.has('note')).toBe(false);
    expect(findItem(state, `assignment:${IDS.assignments.bioQuiz3Today}`)?.state).toBe('open');
  });

  it("shows can't load with the offline flag after a network error with nothing cached", async () => {
    const h = await createHarness();
    h.canvas.fail('listCourses', canvasError('network'), { times: 1 });

    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'cant_load',
      origin: ORIGIN,
      offline: true,
      savedOrigin: null,
      offer: null,
    });
  });

  it.each([
    ['rate_limited', 429, false],
    ['server', 503, false],
    ['network', undefined, true],
  ] as const)(
    'keeps the last list with a stale line after a %s error',
    async (kind, status, offline) => {
      const h = await createHarness();
      await loadReady(h);
      const loadedAt = new Date(Date.now()).toISOString();
      await vi.advanceTimersByTimeAsync(61_000);
      h.canvas.fail('listPlannerItems', canvasError(kind, status), { times: 1 });

      await h.owner.trigger('focus');
      await h.owner.settled();
      const state = expectReady(await h.owner.getState(PANEL));

      expect(state.stale).toEqual({ since: loadedAt, offline });
      expect(state.view.groups.length).toBeGreaterThan(0);
    },
  );

  it('shows no active courses when the course list is empty', async () => {
    const scenario = buildScenario(new Date(Date.now()).toISOString());
    scenario.courses = [];
    const h = await createHarness({ scenario });

    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'no_courses',
      origin: ORIGIN,
      offer: null,
    });
    expect(h.canvas.callsOf('listPlannerItems')).toHaveLength(0);
  });

  it('skips one course whose request fails and still shows the rest', async () => {
    const h = await createHarness();
    h.canvas.fail('listUndatedAssignments', canvasError('not_found', 404), {
      firstArg: C.calculus,
    });

    const state = await loadReady(h);
    h.canvas.resetCalls();
    await h.owner.getState(PANEL);
    await h.owner.settled();

    expect(state.stale).toBeNull();
    const undatedKeys = viewItems(state.view)
      .filter((item) => item.due === null)
      .map((item) => item.courseId);
    expect(undatedKeys).toContain(C.biology);
    expect(undatedKeys).not.toContain(C.calculus);
    // The failed course waits for the next refresh round, so a view does not ask again.
    expect(h.canvas.calls).toEqual([]);
  });

  it.each([
    ['server', 503],
    ['not_canvas', 200],
  ] as const)(
    'skips one course whose request fails with a %s error in a refresh round',
    async (kind, status) => {
      const h = await createHarness();
      await loadReady(h);
      await advance(h, 5 * 60_000);
      h.canvas.fail('listUndatedAssignments', canvasError(kind, status), { firstArg: C.calculus });
      h.canvas.fail('listAssignmentsByIds', canvasError(kind, status), { firstArg: C.calculus });

      await h.owner.refresh('timer', FROM_PANEL);
      await h.owner.settled();
      const state = expectReady(await h.owner.getState(PANEL));

      expect(state.stale).toBeNull();
      expect(state.skippedCourses).toEqual([{ id: C.calculus, name: 'MATH 221' }]);
      expect(state.view.groups.length).toBeGreaterThan(0);
    },
  );

  it('goes stale when every request of a load with no shared request fails with 5xx', async () => {
    const h = await createHarness();
    await loadReady(h);
    for (const method of ['listUndatedAssignments', 'listAssignmentsByIds'] as const) {
      h.canvas.fail(method, canvasError('server', 503));
    }
    await settingsItem.setValue({ ...(await settingsItem.getValue()), hiddenCourseIds: [] });

    // Showing the club course needs only its own requests.
    await h.owner.refresh('settings', FROM_PANEL);
    await h.owner.settled();
    const state = expectReady(await h.owner.getState(PANEL));

    expect(h.canvas.callsOf('listUndatedAssignments')).toContainEqual([C.club]);
    expect(state.stale).toMatchObject({ offline: false });
    expect(state.skippedCourses).toEqual([]);
  });

  it('names the courses whose requests failed, by their course code', async () => {
    const h = await createHarness();
    h.canvas.fail('listUndatedAssignments', canvasError('not_found', 404), {
      firstArg: C.calculus,
    });
    h.canvas.fail('listAssignmentsByIds', canvasError('forbidden', 403), { firstArg: C.biology });

    const state = await loadReady(h);

    expect(state.skippedCourses).toEqual([
      { id: C.biology, name: 'BIO 110' },
      { id: C.calculus, name: 'MATH 221' },
    ]);
    const home = expectReady(await h.owner.getState({ ...PANEL, scopeCourseId: C.biology }));
    expect(home.skippedCourses).toEqual([{ id: C.biology, name: 'BIO 110' }]);
    const other = expectReady(await h.owner.getState({ ...PANEL, scopeCourseId: C.history }));
    expect(other.skippedCourses).toEqual([]);
  });

  it('forgets a failed course when the next round loads it', async () => {
    const h = await createHarness();
    h.canvas.fail('listUndatedAssignments', canvasError('not_found', 404), {
      firstArg: C.calculus,
      times: 1,
    });
    expect((await loadReady(h)).skippedCourses).toEqual([{ id: C.calculus, name: 'MATH 221' }]);

    await h.owner.refresh('retry', FROM_PANEL);
    await h.owner.settled();

    expect(expectReady(await h.owner.getState(PANEL)).skippedCourses).toEqual([]);
  });

  it('keeps a course filter while the course is in the list, even in a week without its items', async () => {
    const h = await createHarness();
    await loadReady(h);
    const filtered = { ...PANEL, courseFilter: C.biology };

    expect(expectReady(await h.owner.getState(filtered)).view.courseFilter).toBe(C.biology);
    const later = { ...filtered, weekOffset: 30 };
    await h.owner.getState(later);
    await h.owner.settled();
    expect(expectReady(await h.owner.getState(later)).view.courseFilter).toBe(C.biology);
  });

  it('drops a course filter when the rings are off', async () => {
    const h = await createHarness({ settings: { showRings: false } });
    await loadReady(h);

    const state = expectReady(await h.owner.getState({ ...PANEL, courseFilter: C.biology }));

    expect(state.view.courseFilter).toBeUndefined();
    expect(viewItems(state.view).map((item) => item.courseId)).toContain(C.history);
  });

  it('drops a course filter for a hidden course or a course that left the list', async () => {
    const h = await createHarness();
    await loadReady(h);

    const hidden = expectReady(await h.owner.getState({ ...PANEL, courseFilter: C.club }));
    const gone = expectReady(await h.owner.getState({ ...PANEL, courseFilter: '999' }));
    const personal = expectReady(await h.owner.getState({ ...PANEL, courseFilter: null }));

    expect(hidden.view.courseFilter).toBeUndefined();
    expect(gone.view.courseFilter).toBeUndefined();
    expect(personal.view.courseFilter).toBeNull();
  });

  it('lists every active course for the settings page, hidden ones included', async () => {
    const h = await createHarness();
    const courses = await h.owner.listCourses();
    expect(courses.map((course) => course.id)).toEqual([
      C.history,
      C.biology,
      C.calculus,
      C.chemistry,
      C.club,
      C.orientation,
    ]);
  });
});

describe('another user', () => {
  const ART = '900';

  /** Signs another student in to the same Canvas, with one course and no work. */
  function signInOtherUser(h: Awaited<ReturnType<typeof createHarness>>): void {
    const scenario = h.canvas.scenario;
    const [template] = scenario.courses;
    if (template === undefined) throw new Error('The scenario has no course');
    scenario.self = { ...scenario.self, id: '7777', name: 'Sam Other' };
    scenario.profile = { ...scenario.profile, id: '7777', name: 'Sam Other' };
    scenario.courses = [{ ...template, id: ART, name: 'Art 101', course_code: 'ART 101' }];
    scenario.groups = [];
    scenario.colors = { custom_colors: {} };
    scenario.dashboardPositions = { dashboard_positions: {} };
    scenario.plannerItems = [];
    scenario.assignments = {};
    scenario.undatedAssignments = {};
    scenario.customGradeStatuses = {};
  }

  it('drops every piece of the old user and loads the new one from scratch', async () => {
    const h = await createHarness();
    const before = await loadReady(h);
    expect(viewItems(before.view).length).toBeGreaterThan(0);
    const reply = await h.owner.act({
      kind: 'deleteTask',
      noteId: IDS.notes.libraryBooksToday,
    });
    const undoToken = reply.undo?.token ?? '';
    expect(expectReady(await h.owner.getState({ ...PANEL, undoToken })).undo).toEqual({
      kind: 'deleted',
      count: 1,
    });
    signInOtherUser(h);
    await vi.advanceTimersByTimeAsync(61_000);

    await h.owner.trigger('focus');
    await h.owner.settled();
    const after = expectReady(await h.owner.getState({ ...PANEL, undoToken }));

    expect(h.canvas.callsOf('getProfile')).toHaveLength(2);
    expect(viewItems(after.view)).toEqual([]);
    expect(after.view.rings.map((ring) => ring.courseId)).toEqual([]);
    expect(after.taskCourses).toEqual([{ id: ART, name: 'Art 101' }]);
    // The surface that shows the old user's Undo notice learns that it is gone.
    expect(after.undo).toBeNull();
    const cached = (await fakeBrowser.storage.session.get('weekrowCache'))['weekrowCache'] as {
      session: { profile: { id: string } };
      details: Record<string, unknown>;
      undated: Record<string, unknown>;
      patches: unknown[];
      undos: Record<string, unknown>;
    };
    expect(cached.session.profile.id).toBe('7777');
    expect(cached.details).toEqual({});
    expect(Object.keys(cached.undated)).toEqual([ART]);
    expect(cached.patches).toEqual([]);
    expect(cached.undos).toEqual({});

    // The old user's pending delete is gone with the data.
    await h.owner.act({ kind: 'endUndo', token: undoToken });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await h.owner.settled();
    expect(h.canvas.callsOf('deleteNote')).toEqual([]);
  });

  it('keeps the data while the same user stays signed in', async () => {
    const h = await createHarness();
    await loadReady(h);
    await vi.advanceTimersByTimeAsync(61_000);
    h.canvas.resetCalls();

    await h.owner.trigger('focus');
    await h.owner.settled();

    expect(h.canvas.callsOf('getSelf')).toHaveLength(1);
    expect(h.canvas.callsOf('getProfile')).toHaveLength(0);
  });
});
