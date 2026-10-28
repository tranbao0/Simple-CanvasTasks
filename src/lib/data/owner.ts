/**
 * The single data owner. See docs/design.md, decisions 2, 5, 6, 9, 10 and 11.
 *
 * It owns every Canvas request, the memory-only cache, the refresh policy, the optimistic
 * writes and the setup check. Surfaces ask it for their state and send it actions; they learn
 * about new data from the change marker in `storage.local`.
 *
 * Everything it touches comes in through `DataOwnerDeps`, so it does not depend on where it
 * runs. The background uses it today; a panel page or a content script could host it instead.
 */
import type { CanvasApi, PlannerOverride, TimeRange } from '../canvas/types';
import type { ProbeResult } from '../canvas/probe';
import { canAutoSaveOrigin } from '../inpage/origin';
import {
  moveToTodayTodoDate,
  redoBlocksDone,
  todoDateFor,
  type Item,
  type Offer,
  type Settings,
  type SurfaceState,
  type UndoInfo,
} from '../model';
import { isInstructureHost, normalizeAddress, originMatchPattern } from '../platform/address';
import type { SeenNotes } from '../platform/storage';
import type { TaskInput } from '../ui/contract';
import {
  emptyCache,
  isSessionCache,
  isSetupStatus,
  prunePlanner,
  rangeCovers,
  rangeKey,
  setupStatusOrigin,
  type Failure,
  type SessionCache,
  type SessionData,
  type SetupStatus,
  type StoredUndo,
  type UndoEntry,
  type UndoRecord,
} from './cache';
import { failureFor, isCanvasError, isRefreshFailure } from './failures';
import {
  applyPatch,
  matchesTarget,
  overrideTargetFor,
  pendingOverride,
  propagateOverrideId,
  remapNoteId,
  remapUndoNotes,
  type NotePatch,
  type NoteValue,
  type OverrideFlags,
  type OverridePatch,
  type OverrideTarget,
  type Patch,
} from './patches';
import { decideRound, limitsAfterStart, scopeForTrigger, type LimitedTrigger } from './policy';
import type {
  ActionReply,
  CourseChoice,
  DataAction,
  RefreshReason,
  RequestSurface,
  SeenNote,
  SurfaceRequest,
} from './protocol';
import {
  UserChangedError,
  clearData,
  commitUpdate,
  hasNeeds,
  needsFor,
  runRound,
  uniqueRanges,
  type RoundKind,
  type RoundUpdate,
} from './rounds';
import {
  allItems,
  canvasTimeZone,
  courseChoices,
  isoInstant,
  offerForSurface,
  plannerRangeForView,
  skippedCourseChoices,
  viewFor,
  type ViewContext,
} from './state';

/**
 * A deleted task is sent to Canvas when its Undo notice ends, and at the latest this long after
 * the delete, so a closed panel cannot keep a task alive (decision 10).
 */
export const MAX_DELETE_DELAY_MS = 2 * 60_000;
/** At most this many undo records are kept. A record past the cap ends like a closed notice. */
export const MAX_UNDO_RECORDS = 20;
/** A planner range counts as in use for this long after a surface showed it. */
export const ACTIVE_RANGE_MS = 10 * 60_000;
/** At most this many recently shown ranges are refreshed, besides the current week. */
export const MAX_ACTIVE_RANGES = 4;
/** Temporary ids of custom tasks that Canvas has not created yet. */
export const TEMP_NOTE_PREFIX = 'pending-';

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** A stored value, such as a storage item from src/lib/platform/storage.ts. */
export interface StoredValue<T> {
  getValue(): Promise<T>;
  setValue(value: T): Promise<void>;
}

/** Everything the owner stores. Only settings, the address, the marker and seen notes are local. */
export interface DataStore {
  origin: StoredValue<string | null>;
  settings: StoredValue<Settings>;
  changeMarker: StoredValue<number>;
  seenNotes: StoredValue<SeenNotes>;
  offer: StoredValue<Offer | null>;
  cache: StoredValue<SessionCache | null>;
  setup: StoredValue<SetupStatus | null>;
}

export interface DataOwnerDeps {
  createApi(origin: string): CanvasApi;
  /** The setup check of decision 5. */
  probe(origin: string): Promise<ProbeResult>;
  hasAccess(origin: string): Promise<boolean>;
  /** Removes an optional host grant that the extension no longer needs (decision 5). */
  removeAccess(origin: string): Promise<void>;
  /** Keeps the runtime content script registration correct after the address changes. */
  syncContentScripts(): Promise<void>;
  store: DataStore;
  clock: Clock;
  timers: Timers;
  browserTimeZone(): string;
  browserLanguage(): string | null;
  isFirefox: boolean;
  log(step: string, error: unknown): void;
}

/** Refresh triggers that come from the browser rather than from a surface. */
export type BrowserTrigger = 'page_loaded' | 'focus' | 'startup';

/** Who asked for a refresh. */
export interface RefreshSource {
  surface: RequestSurface;
  /** The sender is an extension page, not a content script. */
  fromExtensionPage: boolean;
}

export interface RefreshResult {
  /** Epoch milliseconds when a full round that the 60-second limit put off can run. */
  retryAt: number | null;
}

export interface DataOwner {
  getState(request: SurfaceRequest): Promise<SurfaceState>;
  refresh(reason: RefreshReason, source: RefreshSource): Promise<RefreshResult>;
  trigger(reason: BrowserTrigger): Promise<void>;
  /** A page of `origin` loaded. Only the saved Canvas counts. */
  pageLoaded(origin: string): Promise<void>;
  /**
   * A content script found Canvas on an `instructure.com` page of `origin`. Saves the origin
   * when no address is saved yet and it may be saved without asking. Resolves with the saved
   * address after the call.
   */
  canvasDetected(origin: string): Promise<string | null>;
  act(action: DataAction): Promise<ActionReply>;
  /** Starts the setup check for an address. The permission must already be granted. */
  setup(origin: string, fromOffer: boolean): Promise<void>;
  /** Opens the address form. The saved address stays until a new one passes the check. */
  changeAddress(): Promise<void>;
  /** All active student courses, hidden ones included, for the settings page. */
  listCourses(): Promise<CourseChoice[]>;
  /** The saved address changed in storage. */
  originChanged(origin: string | null): Promise<void>;
  /** A host permission was granted or removed. */
  accessChanged(): Promise<void>;
  /** Resolves when no round, write, setup check or storage write is running or queued. */
  settled(): Promise<void>;
  /** Stops every timer, as when the worker that hosts the owner stops. */
  dispose(): void;
}

const NO_UNDO: ActionReply = { undo: null };
const NO_RETRY: RefreshResult = { retryAt: null };

interface WriteContext {
  origin: string;
  session: SessionData;
  context: ViewContext;
  items: Map<string, Item>;
}

type NoteOperation = 'create' | 'update' | 'delete';

/** The saved address while the student checks a different one, otherwise `null`. */
function otherSavedOrigin(saved: string | null, origin: string): string | null {
  return saved !== null && saved !== origin ? saved : null;
}

function setupState(status: SetupStatus, saved: string | null, offer: Offer | null): SurfaceState {
  switch (status.kind) {
    case 'entering':
      return { kind: 'not_set_up', offer, savedOrigin: saved };
    case 'rejected':
      return {
        kind: 'not_canvas',
        origin: status.text,
        savedOrigin: otherSavedOrigin(saved, status.text),
      };
    case 'checking':
    case 'redirects':
    case 'not_canvas':
    case 'unreachable':
      return {
        kind: status.kind,
        origin: status.origin,
        savedOrigin: otherSavedOrigin(saved, status.origin),
      };
  }
}

/**
 * Whether a setup status shows on a surface. The in-page list runs on the saved Canvas, so the
 * address form and checks of other addresses are not its business.
 */
function statusApplies(status: SetupStatus, surface: RequestSurface, saved: string | null) {
  return !(surface === 'inpage' && saved !== null && setupStatusOrigin(status) !== saved);
}

/** Round failures stop ensure loads. A failed write does not, so a new week still loads. */
function blocksLoads(failure: Failure | null): boolean {
  return failure !== null && !(failure.kind === 'stale' && failure.source === 'write');
}

function previousFlags(item: Item): OverrideFlags {
  return item.override === null
    ? { markedComplete: false, dismissed: false }
    : { markedComplete: item.override.markedComplete, dismissed: item.override.dismissed };
}

/**
 * The flags of a Skip: dismissed, with the current done flag. On work whose redo request blocks
 * done, the done flag goes false, so a later submission that marks it done clears the skip.
 */
function skipFlags(item: Item): OverrideFlags {
  return {
    markedComplete: redoBlocksDone(item) ? false : (item.override?.markedComplete ?? false),
    dismissed: true,
  };
}

const NOTE_KEY_PREFIX = 'planner_note:';

function noteKey(noteId: string): string {
  return `${NOTE_KEY_PREFIX}${noteId}`;
}

function isTempNoteId(id: string): boolean {
  return id.startsWith(TEMP_NOTE_PREFIX);
}

function noteInput(note: NoteValue) {
  return {
    title: note.title,
    details: note.details,
    todoDate: note.todoDate,
    courseId: note.courseId,
  };
}

function trimmedDetails(details: string | null): string | null {
  const text = details?.trim() ?? '';
  return text === '' ? null : text;
}

/** The POST of decision 2, with the recovery for an override that already exists. */
async function createOrRecoverOverride(
  api: CanvasApi,
  target: OverrideTarget,
  flags: OverrideFlags,
): Promise<PlannerOverride> {
  try {
    return await api.createOverride({
      plannableType: target.plannableType,
      plannableId: target.plannableId,
      ...flags,
    });
  } catch (error) {
    if (!isCanvasError(error, 'bad_request')) throw error;
    const overrides = await api.listPlannerOverrides();
    const existing = overrides.find(
      (override) => override.workflow_state !== 'deleted' && matchesTarget(override, target),
    );
    if (existing === undefined) throw error;
    return api.updateOverride(existing.id, flags);
  }
}

interface Restored {
  cache: SessionCache;
  /** Override writes that never got an answer. They are sent again. */
  resend: number[];
  /** Some pending writes could not be sent again, so the list must sync with Canvas. */
  dropped: boolean;
}

/**
 * The cache after a service worker restart. Writes that never got an answer died with the old
 * worker. Override writes are sent again, because the POST, 400 recovery and PUT sequence is
 * safe to repeat. A task create or update is not, so it is dropped. Delayed deletes stay.
 */
function restore(stored: SessionCache): Restored {
  const patches: Patch[] = [];
  const resend: number[] = [];
  let dropped = false;
  for (const patch of stored.patches) {
    if (patch.confirmedAt !== null) {
      patches.push(patch);
    } else if (patch.kind === 'override') {
      patches.push(patch);
      resend.push(patch.id);
    } else if (patch.note === null && patch.deleteAt !== null) {
      patches.push(patch);
    } else {
      dropped = true;
    }
  }
  return { cache: { ...stored, patches }, resend, dropped };
}

export function createDataOwner(deps: DataOwnerDeps): DataOwner {
  const { store, clock, timers } = deps;

  let loading: Promise<void> | null = null;
  let knownOrigin: string | null = null;
  let cache: SessionCache | null = null;
  let setupStatus: SetupStatus | null = null;
  /** Grows when the address changes or the data is cleared, so old async work is dropped. */
  let generation = 0;
  let lastMarker = 0;
  let setupRun = 0;

  const apis = new Map<string, CanvasApi>();
  const requested = new Map<string, { range: TimeRange; at: number }>();
  const pending: Record<RoundKind, boolean> = { full: false, light: false, ensure: false };
  let running = false;
  let runner: Promise<void> = Promise.resolve();
  let deferTimer: unknown = null;

  let writeChain: Promise<void> = Promise.resolve();
  let pendingWrites = 0;
  let confirmedSinceRefresh = false;
  let persistChain: Promise<void> = Promise.resolve();

  /** The latest-send timers of delayed task deletes, by patch id. */
  const deleteTimers = new Map<number, unknown>();
  /** Delayed deletes whose DELETE job is queued. */
  const queuedDeletes = new Set<number>();
  /** Delayed deletes whose DELETE request has started. Undo can no longer stop them. */
  const startedDeletes = new Set<number>();
  const tasks = new Set<Promise<unknown>>();

  function track(promise: Promise<unknown>): void {
    const tracked = promise.catch((error: unknown) => deps.log('data task', error));
    tasks.add(tracked);
    void tracked.finally(() => tasks.delete(tracked));
  }

  function nextId(): number {
    if (cache === null) return 0;
    const id = cache.nextId;
    cache = { ...cache, nextId: id + 1 };
    return id;
  }

  function apiFor(origin: string): CanvasApi {
    let api = apis.get(origin);
    if (api === undefined) {
      api = deps.createApi(origin);
      apis.set(origin, api);
    }
    return api;
  }

  function persist(): void {
    const value = cache;
    persistChain = persistChain
      .then(() => store.cache.setValue(value))
      .catch((error: unknown) => deps.log('cache write', error));
  }

  /** Writes a new change marker, so every surface asks for its state again. */
  async function bump(): Promise<void> {
    lastMarker = Math.max(clock.now(), lastMarker + 1);
    await store.changeMarker.setValue(lastMarker);
  }

  function bumpLater(): void {
    track(bump());
  }

  /** The real id of a custom task, for a temporary id that Canvas has replaced. */
  function resolveNoteId(id: string): string {
    return cache?.noteIds[id] ?? id;
  }

  /** The item key, with a temporary task id replaced by its real id. */
  function resolveKey(key: string): string {
    if (!key.startsWith(NOTE_KEY_PREFIX)) return key;
    return noteKey(resolveNoteId(key.slice(NOTE_KEY_PREFIX.length)));
  }

  async function load(): Promise<void> {
    const [origin, stored, setup, marker] = await Promise.all([
      store.origin.getValue(),
      store.cache.getValue(),
      store.setup.getValue(),
      store.changeMarker.getValue(),
    ]);
    knownOrigin = origin;
    setupStatus = isSetupStatus(setup) ? setup : null;
    lastMarker = marker;
    // A check that was running when the old worker stopped never finished, so run it again.
    if (setupStatus?.kind === 'checking') track(runSetupCheck(setupStatus.origin));
    if (origin === null) {
      cache = null;
      return;
    }
    if (!isSessionCache(stored) || stored.origin !== origin) {
      cache = emptyCache(origin);
      return;
    }
    const restored = restore(stored);
    cache = restored.cache;
    for (const patch of cache.patches) {
      if (patch.kind === 'note' && patch.confirmedAt === null) scheduleDelete(patch);
    }
    for (const id of restored.resend) enqueueWrite(() => runOverrideWrite(id));
    // Sent writes ask for a full round when they finish. Dropped ones need it now.
    if (restored.dropped && restored.resend.length === 0) scheduleForcedFull();
  }

  function ready(): Promise<void> {
    loading ??= load();
    return loading;
  }

  async function viewContext(origin: string): Promise<ViewContext> {
    return {
      origin,
      now: clock.now(),
      settings: await store.settings.getValue(),
      browserTimeZone: deps.browserTimeZone(),
      browserLanguage: deps.browserLanguage(),
    };
  }

  /** The current week, plus every range a surface showed in the last 10 minutes. */
  function rangesInUse(session: SessionData, context: ViewContext): TimeRange[] {
    for (const [key, entry] of requested) {
      if (context.now - entry.at > ACTIVE_RANGE_MS) requested.delete(key);
    }
    const current = plannerRangeForView(session, 0, context);
    // The map is in the order the ranges were last shown, oldest first.
    const recent = [...requested.values()].slice(-MAX_ACTIVE_RANGES).map((entry) => entry.range);
    return uniqueRanges([current, ...recent]);
  }

  function visibleCourseIds(session: SessionData, settings: Settings): string[] {
    const hidden = new Set(settings.hiddenCourseIds);
    return session.courses.filter((course) => !hidden.has(course.id)).map((course) => course.id);
  }

  // ---------------------------------------------------------------------------------------------
  // Rounds
  // ---------------------------------------------------------------------------------------------

  function anyPending(): boolean {
    return pending.full || pending.light || pending.ensure;
  }

  function takeJob(): RoundKind | null {
    if (pending.full) {
      pending.full = false;
      pending.light = false;
      return 'full';
    }
    if (pending.light) {
      pending.light = false;
      return 'light';
    }
    if (pending.ensure) {
      pending.ensure = false;
      return 'ensure';
    }
    return null;
  }

  function pump(): void {
    if (running) return;
    running = true;
    runner = (async () => {
      try {
        for (let job = takeJob(); job !== null; job = takeJob()) {
          await executeRound(job).catch((error: unknown) => deps.log('refresh round', error));
        }
      } finally {
        running = false;
      }
    })();
  }

  function schedule(kind: RoundKind): void {
    pending[kind] = true;
    pump();
  }

  /** A round that skips the 60-second limit, after a write or an address change. */
  function scheduleForcedFull(): void {
    if (cache === null) return;
    cache = { ...cache, limits: limitsAfterStart(cache.limits, 'full', clock.now()) };
    schedule('full');
  }

  function cancelDefer(): void {
    if (deferTimer === null) return;
    timers.clearTimeout(deferTimer);
    deferTimer = null;
  }

  /**
   * Runs a full round that the 60-second limit put off. This timer is a best effort: a stopped
   * worker loses it, so the surfaces also ask again at `at` (decision 11).
   */
  function deferFull(at: number): void {
    if (deferTimer !== null) return;
    const requestedAt = clock.now();
    deferTimer = timers.setTimeout(
      () => {
        deferTimer = null;
        // A surface that asked again at the same time may already have run the round.
        const lastFull = cache?.limits.lastFullAt ?? null;
        if (lastFull === null || lastFull < requestedAt) scheduleForcedFull();
      },
      Math.max(0, at - requestedAt),
    );
  }

  /** Applies a confirmed patch to the cached Canvas data, so it survives fresh rounds. */
  function bake(target: SessionCache, patch: Patch): SessionCache {
    const session = target.session;
    if (session === null) return target;
    const context = { courses: session.courses, userId: session.profile.id };
    const planner = Object.fromEntries(
      Object.entries(target.planner).map(([key, entry]) => [
        key,
        {
          ...entry,
          items: [
            ...applyPatch({ plannerItems: entry.items, overrides: null }, patch, context)
              .plannerItems,
          ],
        },
      ]),
    );
    const overrides =
      target.overrides === null
        ? null
        : applyPatch({ plannerItems: [], overrides: target.overrides }, patch, context).overrides;
    return { ...target, planner, overrides: overrides === null ? null : [...overrides] };
  }

  /**
   * After a successful round: patches confirmed before the round started are now in the
   * fresh data and can go. Patches confirmed during the round go into the new data again.
   */
  function settlePatches(target: SessionCache, startedAt: number): SessionCache {
    let next = target;
    const kept: Patch[] = [];
    for (const patch of target.patches) {
      if (patch.confirmedAt === null) kept.push(patch);
      else if (patch.confirmedAt > startedAt) {
        next = bake(next, patch);
        kept.push(patch);
      }
    }
    return { ...next, patches: kept };
  }

  /** Marks the entries that hold the ranges surfaces showed, so pruning keeps them. */
  function markRangesUsed(target: SessionCache): SessionCache {
    const planner = { ...target.planner };
    for (const { range, at } of requested.values()) {
      for (const [key, cached] of Object.entries(planner)) {
        if (rangeCovers(cached.range, range)) {
          planner[key] = { ...cached, usedAt: Math.max(cached.usedAt, at) };
        }
      }
    }
    return { ...target, planner: prunePlanner(planner) };
  }

  function clearSessionWork(): void {
    for (const timer of deleteTimers.values()) timers.clearTimeout(timer);
    deleteTimers.clear();
    queuedDeletes.clear();
    startedDeletes.clear();
  }

  /**
   * Another user signed in to Canvas. Nothing of the old user may stay: no item, ring, course
   * choice, pending write or undo. The new user's session then loads from scratch.
   */
  async function dropUserData(): Promise<void> {
    if (cache === null) return;
    generation += 1;
    clearSessionWork();
    requested.clear();
    cancelDefer();
    cache = { ...clearData(cache), failure: null };
    persist();
    scheduleForcedFull();
    await bump();
  }

  async function executeRound(job: RoundKind): Promise<void> {
    const origin = knownOrigin;
    if (origin === null || cache === null) return;
    if (job === 'ensure' && blocksLoads(cache.failure)) return;
    if (!(await deps.hasAccess(origin))) return;
    const gen = generation;
    const context = await viewContext(origin);
    if (gen !== generation || cache === null) return;

    let kind: RoundKind = job;
    if (cache.session === null) {
      kind = 'full';
      cache = { ...cache, limits: limitsAfterStart(cache.limits, 'full', context.now) };
    } else if (kind === 'ensure') {
      const needs = needsFor({
        cache,
        ranges: rangesInUse(cache.session, context),
        visibleCourseIds: visibleCourseIds(cache.session, context.settings),
        hiddenCourseIds: context.settings.hiddenCourseIds,
      });
      if (!hasNeeds(needs)) return;
    }
    if (kind !== 'ensure') bumpLater();

    const startedAt = context.now;
    const api = apiFor(origin);
    let update: RoundUpdate | null = null;
    let failure: Failure | null = null;
    try {
      update = await runRound({
        api,
        kind,
        cache,
        hiddenCourseIds: context.settings.hiddenCourseIds,
        rangesFor: (session) => rangesInUse(session, context),
        now: startedAt,
      });
    } catch (error) {
      if (error instanceof UserChangedError) {
        if (gen === generation) await dropUserData();
        return;
      }
      deps.log('refresh round', error);
      failure = await failureFor(error, api, clock.now());
    }
    if (gen !== generation || cache === null) return;

    if (update !== null) {
      cache = markRangesUsed(settlePatches(commitUpdate(cache, update, clock.now()), startedAt));
    } else if (failure?.kind === 'signed_out') {
      clearSessionWork();
      cache = { ...clearData(cache), failure };
    } else {
      cache = { ...cache, failure };
    }
    persist();
    await bump();
  }

  /** Applies the refresh policy. Resolves with the time of a full round it put off, if any. */
  async function applyTrigger(trigger: LimitedTrigger): Promise<number | null> {
    await ready();
    if (knownOrigin === null || cache === null) return null;
    const now = clock.now();
    // A Canvas page load after a sign-out is the sign-in signal, so it skips the limit.
    if (trigger === 'page_loaded' && cache.failure?.kind === 'signed_out') {
      scheduleForcedFull();
      return null;
    }
    const scope = scopeForTrigger(trigger, cache.limits, now);
    if (scope === null) return null;
    const decision = decideRound(scope, cache.limits, now);
    switch (decision.kind) {
      case 'run':
        cache = { ...cache, limits: limitsAfterStart(cache.limits, decision.scope, now) };
        schedule(decision.scope);
        return null;
      case 'defer':
        deferFull(decision.at);
        return decision.at;
      case 'skip':
        return null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Address and setup
  // ---------------------------------------------------------------------------------------------

  /**
   * Removes the optional host grant of an address that is no longer in use: not an
   * `instructure.com` host (a required permission), not the saved address, and not the address
   * of a check that is running or that Retry can run again.
   */
  async function releaseGrant(origin: string): Promise<void> {
    if (isInstructureHost(origin)) return;
    const pattern = originMatchPattern(origin);
    if (pattern === null) return;
    const saved = await store.origin.getValue();
    if (saved !== null && originMatchPattern(saved) === pattern) return;
    const status = setupStatus;
    if (
      (status?.kind === 'checking' || status?.kind === 'unreachable') &&
      originMatchPattern(status.origin) === pattern
    ) {
      return;
    }
    await deps.removeAccess(origin).catch((error: unknown) => deps.log('remove access', error));
  }

  async function setSetup(status: SetupStatus | null): Promise<void> {
    const previous = setupStatusOrigin(setupStatus);
    setupStatus = status;
    await store.setup.setValue(status);
    await bump();
    if (previous !== null && previous !== setupStatusOrigin(status)) await releaseGrant(previous);
  }

  async function handleOrigin(origin: string | null): Promise<void> {
    if (origin === knownOrigin) return;
    knownOrigin = origin;
    generation += 1;
    clearSessionWork();
    requested.clear();
    cancelDefer();
    cache = origin === null ? null : emptyCache(origin);
    persist();
    if (origin !== null) scheduleForcedFull();
    await bump();
  }

  async function syncContentScripts(): Promise<void> {
    await deps
      .syncContentScripts()
      .catch((error: unknown) => deps.log('content script sync', error));
  }

  /** Saves an address that passed the check. It replaces the saved one only now. */
  async function saveAddress(origin: string): Promise<void> {
    const previous = await store.origin.getValue();
    // The origin watcher of the background also calls `handleOrigin`. Whichever call comes
    // first starts the full round, and the other one does nothing.
    const changed = origin !== knownOrigin;
    await store.origin.setValue(origin);
    await setSetup(null);
    if (changed) await handleOrigin(origin);
    else scheduleForcedFull();
    if (previous !== null && previous !== origin) await releaseGrant(previous);
    await syncContentScripts();
  }

  async function runSetupCheck(origin: string): Promise<void> {
    setupRun += 1;
    const run = setupRun;
    // Only a usable https origin is ever checked, whatever was stored.
    if (normalizeAddress(origin) !== origin) {
      await setSetup({ kind: 'rejected', text: origin });
      return;
    }
    let result: ProbeResult;
    try {
      result = await deps.probe(origin);
    } catch (error) {
      deps.log('setup check', error);
      result = 'network';
    }
    if (run !== setupRun) return;
    switch (result) {
      case 'canvas':
      case 'signed_out':
        await saveAddress(origin);
        return;
      case 'redirects':
      case 'not_canvas':
        await setSetup({ kind: result, origin });
        await releaseGrant(origin);
        return;
      case 'network':
        await setSetup({ kind: 'unreachable', origin });
        return;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------------------------

  function enqueueWrite(job: () => Promise<boolean>): void {
    pendingWrites += 1;
    writeChain = writeChain.then(async () => {
      try {
        if (await job()) confirmedSinceRefresh = true;
      } catch (error) {
        deps.log('write', error);
      } finally {
        pendingWrites -= 1;
        if (pendingWrites === 0 && confirmedSinceRefresh) {
          confirmedSinceRefresh = false;
          scheduleForcedFull();
        }
      }
    });
  }

  function findPatch(id: number): Patch | undefined {
    return cache?.patches.find((patch) => patch.id === id);
  }

  function replacePatch(id: number, replacement: Patch): void {
    if (cache === null) return;
    cache = {
      ...cache,
      patches: cache.patches.map((patch) => (patch.id === id ? replacement : patch)),
    };
  }

  function dropPatch(id: number): void {
    if (cache === null) return;
    cache = { ...cache, patches: cache.patches.filter((patch) => patch.id !== id) };
  }

  /**
   * Removes a failed write. A 401 that the sign-in check confirms shows the signed-out state.
   * A "Can't refresh" cause of decision 11 shows the stale line. Any other cause means Canvas
   * refused the write itself, such as a task that is gone, so a full round syncs the list.
   */
  async function rollback(
    patchId: number,
    error: unknown,
    api: CanvasApi,
    gen: number,
  ): Promise<void> {
    deps.log('write', error);
    const failure = await failureFor(error, api, clock.now(), 'write');
    if (gen !== generation || cache === null) return;
    dropPatch(patchId);
    if (failure.kind === 'signed_out') {
      clearSessionWork();
      cache = { ...clearData(cache), failure };
    } else if (isRefreshFailure(failure)) {
      // A failed round says more than a failed write, so it stays.
      if (!blocksLoads(cache.failure)) cache = { ...cache, failure };
    } else {
      scheduleForcedFull();
    }
  }

  async function finishWrite(): Promise<void> {
    persist();
    await bump();
  }

  async function runOverrideWrite(patchId: number): Promise<boolean> {
    const origin = knownOrigin;
    const patch = findPatch(patchId);
    if (origin === null || patch === undefined || patch.kind !== 'override') return false;
    if (patch.target.plannableType === 'planner_note' && isTempNoteId(patch.target.plannableId)) {
      // The task this mark belongs to was never created.
      dropPatch(patchId);
      await finishWrite();
      return false;
    }
    const gen = generation;
    const api = apiFor(origin);
    const flags = {
      markedComplete: patch.override.marked_complete,
      dismissed: patch.override.dismissed,
    };
    try {
      const saved =
        patch.override.id !== ''
          ? await api.updateOverride(patch.override.id, flags)
          : await createOrRecoverOverride(api, patch.target, flags);
      if (gen !== generation || cache === null) return false;
      const confirmed: OverridePatch = { ...patch, override: saved, confirmedAt: clock.now() };
      replacePatch(patchId, confirmed);
      cache = bake(
        { ...cache, patches: propagateOverrideId(cache.patches, patch.key, saved.id) },
        confirmed,
      );
      await finishWrite();
      return true;
    } catch (error) {
      await rollback(patchId, error, api, gen);
      await finishWrite();
      return false;
    }
  }

  async function sendNoteWrite(
    api: CanvasApi,
    operation: NoteOperation,
    patch: NotePatch,
    noteId: string,
  ): Promise<NoteValue | null> {
    switch (operation) {
      case 'create': {
        if (patch.note === null) return null;
        const created = await api.createNote(noteInput(patch.note));
        return {
          id: created.id,
          title: created.title,
          details: created.details,
          todoDate: created.todo_date,
          courseId: created.course_id,
        };
      }
      case 'update': {
        if (patch.note === null) return null;
        const updated = await api.updateNote(noteId, noteInput(patch.note));
        return {
          id: updated.id,
          title: updated.title,
          details: updated.details,
          todoDate: updated.todo_date,
          courseId: updated.course_id,
        };
      }
      case 'delete':
        await api.deleteNote(noteId);
        return null;
    }
  }

  async function runNoteWrite(patchId: number, operation: NoteOperation): Promise<boolean> {
    const origin = knownOrigin;
    const patch = findPatch(patchId);
    if (origin === null || patch === undefined || patch.kind !== 'note') return false;
    if (operation === 'delete' && patch.confirmedAt !== null) return false;
    const noteId = resolveNoteId(patch.noteId);
    if (operation !== 'create' && isTempNoteId(noteId)) {
      // The task was never created in Canvas, so there is nothing to change.
      dropPatch(patchId);
      await finishWrite();
      return false;
    }
    const gen = generation;
    const api = apiFor(origin);
    if (operation === 'delete') startedDeletes.add(patchId);
    try {
      const saved = await sendNoteWrite(api, operation, patch, noteId);
      if (gen !== generation || cache === null) return false;
      const realId = saved?.id ?? noteId;
      if (operation === 'create') {
        cache = {
          ...cache,
          noteIds: { ...cache.noteIds, [patch.noteId]: realId },
          patches: remapNoteId(cache.patches, patch.noteId, realId),
          undos: remapUndoNotes(cache.undos, patch.noteId, realId),
        };
      }
      const current = findPatch(patchId);
      if (current === undefined || current.kind !== 'note') return true;
      const confirmed: NotePatch = {
        ...current,
        noteId: realId,
        note: saved,
        confirmedAt: clock.now(),
      };
      replacePatch(patchId, confirmed);
      cache = bake(cache, confirmed);
      await finishWrite();
      return true;
    } catch (error) {
      await rollback(patchId, error, api, gen);
      await finishWrite();
      return false;
    }
  }

  function addPatch(patch: Patch): void {
    if (cache === null) return;
    cache = { ...cache, patches: [...cache.patches, patch] };
  }

  function addOverridePatch(
    key: string,
    target: OverrideTarget,
    flags: OverrideFlags,
    overrideId: string,
    userId: string,
  ): void {
    const patch: OverridePatch = {
      kind: 'override',
      id: nextId(),
      key,
      target,
      override: pendingOverride(target, flags, overrideId, userId),
      confirmedAt: null,
    };
    addPatch(patch);
    enqueueWrite(() => runOverrideWrite(patch.id));
  }

  function addNotePatch(
    noteId: string,
    note: NoteValue | null,
    operation: NoteOperation,
  ): NotePatch {
    const patch: NotePatch = {
      kind: 'note',
      id: nextId(),
      noteId,
      note,
      deleteAt: operation === 'delete' ? clock.now() + MAX_DELETE_DELAY_MS : null,
      confirmedAt: null,
    };
    addPatch(patch);
    if (operation === 'delete') scheduleDelete(patch);
    else enqueueWrite(() => runNoteWrite(patch.id, operation));
    return patch;
  }

  /** Sends a delayed delete at its `deleteAt` at the latest. */
  function scheduleDelete(patch: NotePatch): void {
    const delay = Math.max(0, (patch.deleteAt ?? 0) - clock.now());
    const timer = timers.setTimeout(() => {
      deleteTimers.delete(patch.id);
      sendDelete(patch.id);
    }, delay);
    deleteTimers.set(patch.id, timer);
  }

  /** Queues the DELETE of a delayed task delete, once. */
  function sendDelete(patchId: number): void {
    const timer = deleteTimers.get(patchId);
    if (timer !== undefined) {
      timers.clearTimeout(timer);
      deleteTimers.delete(patchId);
    }
    const patch = findPatch(patchId);
    if (patch?.kind !== 'note' || patch.confirmedAt !== null || queuedDeletes.has(patchId)) return;
    queuedDeletes.add(patchId);
    // A worker that restarts before the job runs sends it at once.
    replacePatch(patchId, { ...patch, deleteAt: clock.now() });
    persist();
    enqueueWrite(() => runNoteWrite(patchId, 'delete'));
  }

  /** Ends the Undo notice of a record: a delayed task delete is sent now. */
  function finishRecord(record: UndoRecord): void {
    if (record.kind === 'delete') sendDelete(record.patchId);
  }

  /**
   * Keeps an undo record in the cache, so it survives a service worker restart. It stays until
   * its notice ends. Past the cap, the oldest records end as if their notice closed.
   */
  function addUndo(record: UndoRecord, info: UndoInfo): string {
    const token = `undo-${nextId()}`;
    if (cache === null) return token;
    const entries: [string, StoredUndo][] = [
      ...Object.entries(cache.undos),
      [token, { record, info, createdAt: clock.now() }],
    ];
    entries.sort(([, a], [, b]) => a.createdAt - b.createdAt);
    const overflow = entries.splice(0, Math.max(0, entries.length - MAX_UNDO_RECORDS));
    cache = { ...cache, undos: Object.fromEntries(entries) };
    for (const [, stored] of overflow) finishRecord(stored.record);
    return token;
  }

  /** Removes an undo record and returns it. */
  function takeUndo(token: string): UndoRecord | null {
    const entry = cache?.undos[token];
    if (cache === null || entry === undefined) return null;
    const rest = Object.entries(cache.undos).filter(([key]) => key !== token);
    cache = { ...cache, undos: Object.fromEntries(rest) };
    persist();
    return entry.record;
  }

  async function writeContext(): Promise<WriteContext | null> {
    await ready();
    const origin = knownOrigin;
    if (origin === null || cache === null || cache.session === null) return null;
    const context = await viewContext(origin);
    if (cache === null || cache.session === null) return null;
    const session = cache.session;
    const items = new Map(allItems(cache, session, context).map((item) => [item.key, item]));
    return { origin, session, context, items };
  }

  async function changeOverrides(
    keys: readonly string[],
    flagsFor: (item: Item) => OverrideFlags | null,
    undoKind: UndoInfo['kind'] | null,
  ): Promise<ActionReply> {
    const write = await writeContext();
    if (write === null) return NO_UNDO;
    const entries: UndoEntry[] = [];
    for (const key of keys.map(resolveKey)) {
      const item = write.items.get(key);
      const target = item === undefined ? null : overrideTargetFor(item);
      const flags = item === undefined ? null : flagsFor(item);
      if (item === undefined || target === null || flags === null) continue;
      addOverridePatch(key, target, flags, item.override?.id ?? '', write.session.profile.id);
      entries.push({ key, target, previous: previousFlags(item) });
    }
    if (entries.length === 0) return NO_UNDO;
    const info: UndoInfo | null =
      undoKind === null ? null : { kind: undoKind, count: entries.length };
    const token = info === null ? null : addUndo({ kind: 'overrides', entries }, info);
    persist();
    bumpLater();
    if (token === null || info === null) return NO_UNDO;
    return { undo: { token, info } };
  }

  async function skipAllOlder(request: SurfaceRequest): Promise<ActionReply> {
    await ready();
    const origin = knownOrigin;
    if (origin === null || cache?.session == null) return NO_UNDO;
    const context = await viewContext(origin);
    if (cache?.session == null) return NO_UNDO;
    const result = viewFor(cache, cache.session, { ...request, weekOffset: 0 }, context);
    const older = result?.view.groups.find((group) => group.kind === 'past_due')?.older ?? [];
    const keys = older.filter((item) => item.canSkip).map((item) => item.key);
    return changeOverrides(keys, skipFlags, 'skipped_all');
  }

  async function undo(token: string): Promise<ActionReply> {
    await ready();
    const record = takeUndo(token);
    if (record === null) return NO_UNDO;
    switch (record.kind) {
      case 'overrides': {
        const write = await writeContext();
        if (write === null) return NO_UNDO;
        for (const { key: rawKey, target, previous } of record.entries) {
          const key = resolveKey(rawKey);
          const current = write.items.get(key);
          const plannableId =
            target.plannableType === 'planner_note'
              ? resolveNoteId(target.plannableId)
              : target.plannableId;
          addOverridePatch(
            key,
            { ...target, plannableId },
            previous,
            current?.override?.id ?? '',
            write.session.profile.id,
          );
        }
        break;
      }
      case 'delete': {
        const patch = findPatch(record.patchId);
        // Once the DELETE has started, the task is gone in Canvas.
        if (
          patch === undefined ||
          patch.confirmedAt !== null ||
          startedDeletes.has(record.patchId)
        ) {
          return NO_UNDO;
        }
        const timer = deleteTimers.get(record.patchId);
        if (timer !== undefined) timers.clearTimeout(timer);
        deleteTimers.delete(record.patchId);
        queuedDeletes.delete(record.patchId);
        // A queued DELETE job finds no patch and sends nothing.
        dropPatch(record.patchId);
        break;
      }
    }
    persist();
    bumpLater();
    return NO_UNDO;
  }

  /** The Undo notice of a token ended, so its record goes and a delayed delete is sent. */
  async function endUndo(token: string): Promise<ActionReply> {
    await ready();
    const record = takeUndo(token);
    if (record !== null) finishRecord(record);
    return NO_UNDO;
  }

  async function writeNote(
    rawNoteId: string | null,
    build: (write: WriteContext, timeZone: string, current: Item | null) => NoteValue | null,
    operation: NoteOperation,
  ): Promise<ActionReply> {
    const write = await writeContext();
    if (write === null || cache === null || cache.limited) return NO_UNDO;
    const noteId = rawNoteId === null ? null : resolveNoteId(rawNoteId);
    const current = noteId === null ? null : (write.items.get(noteKey(noteId)) ?? null);
    if (noteId !== null && current === null) return NO_UNDO;
    const note = build(write, canvasTimeZone(write.session, write.context), current);
    if (operation !== 'delete' && note === null) return NO_UNDO;
    const id = noteId ?? note?.id ?? '';
    const patch = addNotePatch(id, note === null ? null : { ...note, id }, operation);
    const info: UndoInfo = { kind: 'deleted', count: 1 };
    const token =
      operation === 'delete' ? addUndo({ kind: 'delete', patchId: patch.id }, info) : null;
    persist();
    bumpLater();
    if (token === null) return NO_UNDO;
    return { undo: { token, info } };
  }

  function taskNote(id: string, input: TaskInput, timeZone: string): NoteValue {
    return {
      id,
      title: input.title.trim(),
      details: trimmedDetails(input.details),
      todoDate: todoDateFor(input.date, input.time, timeZone),
      courseId: input.courseId,
    };
  }

  /** Leaves the address form or a check of a new address, so the saved address shows again. */
  async function keepSavedAddress(): Promise<ActionReply> {
    if ((await store.origin.getValue()) === null || setupStatus === null) return NO_UNDO;
    setupRun += 1;
    await setSetup(null);
    return NO_UNDO;
  }

  async function markNoteSeen(note: SeenNote): Promise<ActionReply> {
    const seen = await store.seenNotes.getValue();
    await store.seenNotes.setValue({ ...seen, [note]: true });
    await bump();
    return NO_UNDO;
  }

  async function act(action: DataAction): Promise<ActionReply> {
    switch (action.kind) {
      case 'setDone':
        return changeOverrides(
          [action.key],
          (item) =>
            action.done
              ? { markedComplete: true, dismissed: item.override?.dismissed ?? false }
              : { markedComplete: false, dismissed: false },
          action.done ? 'done' : null,
        );
      case 'skip':
        return changeOverrides([action.key], skipFlags, 'skipped');
      case 'unskip':
        return changeOverrides(
          [action.key],
          (item) => ({ markedComplete: item.override?.markedComplete ?? false, dismissed: false }),
          null,
        );
      case 'skipAllOlder':
        return skipAllOlder(action.request);
      case 'undo':
        return undo(action.token);
      case 'endUndo':
        return endUndo(action.token);
      case 'createTask':
        return writeNote(
          null,
          (_write, timeZone) => taskNote(`${TEMP_NOTE_PREFIX}${nextId()}`, action.input, timeZone),
          'create',
        );
      case 'updateTask':
        return writeNote(
          action.noteId,
          (_write, timeZone, current) =>
            current === null ? null : taskNote(current.plannableId, action.input, timeZone),
          'update',
        );
      case 'deleteTask':
        return writeNote(action.noteId, () => null, 'delete');
      case 'moveTaskToToday':
        return writeNote(
          action.noteId,
          (write, timeZone, current) =>
            current === null || current.due === null
              ? null
              : {
                  id: current.plannableId,
                  title: current.title,
                  details: current.noteDetails,
                  todoDate: moveToTodayTodoDate(
                    current.due,
                    isoInstant(write.context.now),
                    timeZone,
                  ),
                  courseId: current.courseId,
                },
          'update',
        );
      case 'markNoteSeen':
        return markNoteSeen(action.note);
      case 'dismissOffer':
        await store.offer.setValue(null);
        await bump();
        return NO_UNDO;
      case 'keepSavedAddress':
        return keepSavedAddress();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------

  function requestEnsure(session: SessionData, context: ViewContext, range: TimeRange): void {
    if (cache === null || blocksLoads(cache.failure)) return;
    const needs = needsFor({
      cache,
      ranges: uniqueRanges([range, plannerRangeForView(session, 0, context)]),
      visibleCourseIds: visibleCourseIds(session, context.settings),
      hiddenCourseIds: context.settings.hiddenCourseIds,
    });
    if (hasNeeds(needs)) schedule('ensure');
  }

  async function getState(request: SurfaceRequest): Promise<SurfaceState> {
    await ready();
    const origin = await store.origin.getValue();
    if (origin !== knownOrigin) await handleOrigin(origin);
    const offer = offerForSurface(await store.offer.getValue(), origin, request.surface);
    if (setupStatus !== null && statusApplies(setupStatus, request.surface, origin)) {
      return setupState(setupStatus, origin, offer);
    }
    if (origin === null) return { kind: 'not_set_up', offer, savedOrigin: null };
    if (!(await deps.hasAccess(origin))) {
      return { kind: 'no_access', origin, savedOrigin: null, offer };
    }
    if (cache === null) return { kind: 'loading' };
    const failure = cache.failure;
    const offline = failure?.kind === 'stale' && failure.offline;
    if (failure?.kind === 'signed_out') {
      return { kind: 'signed_out', origin, isFirefox: deps.isFirefox, offer };
    }
    const session = cache.session;
    if (session === null) {
      if (blocksLoads(failure))
        return { kind: 'cant_load', origin, offline, savedOrigin: null, offer };
      schedule('ensure');
      return { kind: 'loading' };
    }
    if (session.courses.length === 0) return { kind: 'no_courses', origin, offer };

    const context = await viewContext(origin);
    if (cache === null) return { kind: 'loading' };
    const range = plannerRangeForView(session, request.weekOffset, context);
    const key = rangeKey(range);
    requested.delete(key);
    requested.set(key, { range, at: context.now });
    requestEnsure(session, context, range);
    const result = viewFor(cache, session, request, context);
    if (result === null) {
      return blocksLoads(failure)
        ? { kind: 'cant_load', origin, offline, savedOrigin: null, offer }
        : { kind: 'loading' };
    }

    const seenNotes = await store.seenNotes.getValue();
    return {
      kind: 'ready',
      origin,
      view: result.view,
      stale:
        failure?.kind === 'stale'
          ? { since: isoInstant(cache.lastSuccessAt ?? failure.at), offline }
          : null,
      refreshing: running || !result.exact,
      offer,
      // The notice the surface holds, while its record lives.
      undo: (request.undoToken ? cache.undos[request.undoToken]?.info : undefined) ?? null,
      seenNotes: { firstDone: seenNotes.firstDone, firstSkip: seenNotes.firstSkip },
      taskCourses: courseChoices(
        session.courses,
        session.positions,
        context.settings.hiddenCourseIds,
      ),
      skippedCourses: skippedCourseChoices(
        session,
        cache.failedCourses,
        context.settings.hiddenCourseIds,
        request.scopeCourseId,
      ),
    };
  }

  async function settled(): Promise<void> {
    for (;;) {
      await Promise.all([runner, writeChain, persistChain, ...tasks]);
      if (!running && !anyPending() && pendingWrites === 0 && tasks.size === 0) {
        await persistChain;
        return;
      }
    }
  }

  return {
    getState,

    async refresh(reason, source) {
      await ready();
      switch (reason) {
        case 'visible':
        case 'timer':
          return { retryAt: await applyTrigger(reason) };
        case 'midnight':
        case 'settings':
          if (cache !== null && !blocksLoads(cache.failure)) schedule('ensure');
          await bump();
          return NO_RETRY;
        case 'retry': {
          // Only an extension page may check a new address again (decision 5). Every other
          // Retry, such as one in the in-page list, refreshes the saved address.
          const status = setupStatus;
          if (
            status?.kind === 'unreachable' &&
            source.fromExtensionPage &&
            source.surface !== 'inpage'
          ) {
            await setSetup({ kind: 'checking', origin: status.origin });
            track(runSetupCheck(status.origin));
            return NO_RETRY;
          }
          scheduleForcedFull();
          return NO_RETRY;
        }
      }
    },

    async trigger(reason) {
      await applyTrigger(reason);
    },

    async pageLoaded(origin) {
      await ready();
      if (origin !== (await store.origin.getValue())) return;
      await applyTrigger('page_loaded');
    },

    async canvasDetected(origin) {
      await ready();
      const saved = await store.origin.getValue();
      if (!canAutoSaveOrigin(origin, saved)) return saved;
      await store.origin.setValue(origin);
      await handleOrigin(origin);
      await syncContentScripts();
      return origin;
    },

    async act(action) {
      await ready();
      return act(action);
    },

    async setup(origin, fromOffer) {
      await ready();
      if (fromOffer) await store.offer.setValue(null);
      const normalized = normalizeAddress(origin);
      if (normalized === null) {
        setupRun += 1;
        await setSetup({ kind: 'rejected', text: origin });
        return;
      }
      await setSetup({ kind: 'checking', origin: normalized });
      track(runSetupCheck(normalized));
    },

    async changeAddress() {
      await ready();
      setupRun += 1;
      await setSetup({ kind: 'entering' });
    },

    async listCourses() {
      await ready();
      const origin = knownOrigin;
      if (origin === null || cache === null) return [];
      if (cache.session === null && !blocksLoads(cache.failure) && (await deps.hasAccess(origin))) {
        schedule('ensure');
        await runner;
      }
      const session = cache?.session;
      return session == null ? [] : courseChoices(session.courses, session.positions);
    },

    async originChanged(origin) {
      await ready();
      await handleOrigin(origin);
    },

    async accessChanged() {
      await ready();
      await bump();
      scheduleForcedFull();
    },

    settled,

    dispose() {
      clearSessionWork();
      cancelDefer();
    },
  };
}
