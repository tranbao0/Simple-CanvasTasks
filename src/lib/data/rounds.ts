/**
 * One refresh round: which Canvas requests to send, and how their answers update the cache.
 * See docs/design.md, decision 11, "Requests" and "Request rules".
 *
 * - `ensure` loads only what a view needs and the cache lacks.
 * - `light` also reloads the planner items: one range that covers every view in use.
 * - `full` also reloads the assignment details, the undated work and the override list.
 *
 * Light and full rounds also ask `GET /api/v1/users/self`, in parallel with the planner. When
 * another user is signed in, the round fails with `UserChangedError`, so the owner can drop
 * every piece of the old user's data.
 *
 * A round fetches everything first and returns one update, so a surface never sees half a round.
 */
import type {
  Assignment,
  CanvasApi,
  CustomGradeStatus,
  PlannerItem,
  PlannerOverride,
  TimeRange,
  UserSelf,
} from '../canvas/types';
import { assignmentIdsToLookup } from '../model';
import {
  coveringEntry,
  rangeCovers,
  rangeKey,
  spanOf,
  type PlannerEntry,
  type RoundScope,
  type SessionCache,
  type SessionData,
} from './cache';
import { isCanvasError, isCourseScoped, isOutageError } from './failures';

export type RoundKind = 'ensure' | RoundScope;

/** Another user is signed in to Canvas than the one whose session data is cached. */
export class UserChangedError extends Error {
  constructor() {
    super('Another user is signed in to Canvas');
    this.name = 'UserChangedError';
  }
}

/** Keys in `SessionCache.skipped`. */
export const skipKey = {
  details: (assignmentId: string) => `details:${assignmentId}`,
  undated: (courseId: string) => `undated:${courseId}`,
  all: (courseId: string) => `all:${courseId}`,
  statuses: (courseId: string) => `statuses:${courseId}`,
} as const;

/** What a view still needs from Canvas. */
export interface Needs {
  /** Planner ranges with no cached items. Always empty in limited mode. */
  ranges: TimeRange[];
  /** Assignment ids with no cached details, by course. */
  detailIds: Record<string, string[]>;
  undatedCourses: string[];
  overrides: boolean;
  /** Limited mode: courses with no cached assignment list. */
  allCourses: string[];
  statusCourses: string[];
}

export interface NeedsInput {
  cache: SessionCache;
  /** The planner ranges of the views in use. */
  ranges: readonly TimeRange[];
  visibleCourseIds: readonly string[];
  hiddenCourseIds: readonly string[];
}

/** The items of the entries that cover the ranges, each entry once. */
function itemsOf(
  planner: Readonly<Record<string, PlannerEntry>>,
  ranges: readonly TimeRange[],
): PlannerItem[] {
  const entries = new Set<PlannerEntry>();
  for (const range of ranges) {
    const entry = coveringEntry(planner, range);
    if (entry !== null) entries.add(entry);
  }
  return [...entries].flatMap((entry) => entry.items);
}

function isSkipped(cache: Pick<SessionCache, 'skipped'>, key: string): boolean {
  return cache.skipped.includes(key);
}

/** Lookup ids that have no cached details and did not fail this round. */
export function missingDetailIds(
  lookup: Readonly<Record<string, string[]>>,
  cache: Pick<SessionCache, 'details' | 'skipped'>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [courseId, ids] of Object.entries(lookup)) {
    const missing = ids.filter(
      (id) => cache.details[id] === undefined && !isSkipped(cache, skipKey.details(id)),
    );
    if (missing.length > 0) result[courseId] = missing;
  }
  return result;
}

function missingCourses(
  courseIds: readonly string[],
  loaded: Readonly<Record<string, unknown>>,
  cache: Pick<SessionCache, 'skipped'>,
  skip: (courseId: string) => string,
): string[] {
  return courseIds.filter((id) => loaded[id] === undefined && !isSkipped(cache, skip(id)));
}

function isUndatedItem(assignment: Assignment): boolean {
  return assignment.has_sub_assignments !== true;
}

/** The override list is needed when No due date has items, and always in limited mode. */
export function overridesNeeded(
  limited: boolean,
  undated: Readonly<Record<string, Assignment[]>>,
  visibleCourseIds: readonly string[],
): boolean {
  return limited || visibleCourseIds.some((id) => (undated[id] ?? []).some(isUndatedItem));
}

function hasTeacherStatus(assignment: Assignment): boolean {
  const id = assignment.submission?.custom_grade_status_id;
  return typeof id === 'string' && id !== '';
}

/** Visible courses where a teacher status appears and its name is not loaded yet. */
export function statusCoursesNeeded(
  cache: Pick<SessionCache, 'details' | 'undated' | 'allAssignments' | 'gradeStatuses' | 'skipped'>,
  visibleCourseIds: readonly string[],
): string[] {
  const visible = new Set(visibleCourseIds);
  const courses = new Set<string>();
  const consider = (assignment: Assignment): void => {
    if (visible.has(assignment.course_id) && hasTeacherStatus(assignment)) {
      courses.add(assignment.course_id);
    }
  };
  Object.values(cache.details).forEach(consider);
  Object.values(cache.undated).flat().forEach(consider);
  Object.values(cache.allAssignments).flat().forEach(consider);
  return [...courses].filter(
    (id) => cache.gradeStatuses[id] === undefined && !isSkipped(cache, skipKey.statuses(id)),
  );
}

/** What an `ensure` round would load for the views in use. */
export function needsFor(input: NeedsInput): Needs {
  const { cache, ranges, visibleCourseIds, hiddenCourseIds } = input;
  if (cache.limited) {
    return {
      ranges: [],
      detailIds: {},
      undatedCourses: [],
      overrides: cache.overrides === null,
      allCourses: missingCourses(visibleCourseIds, cache.allAssignments, cache, skipKey.all),
      statusCourses: statusCoursesNeeded(cache, visibleCourseIds),
    };
  }
  const missingRanges = uniqueRanges(ranges).filter(
    (range) => coveringEntry(cache.planner, range) === null,
  );
  const lookup = assignmentIdsToLookup(itemsOf(cache.planner, ranges), hiddenCourseIds);
  return {
    ranges: missingRanges,
    detailIds: missingDetailIds(lookup, cache),
    undatedCourses: missingCourses(visibleCourseIds, cache.undated, cache, skipKey.undated),
    overrides: cache.overrides === null && overridesNeeded(false, cache.undated, visibleCourseIds),
    allCourses: [],
    statusCourses: statusCoursesNeeded(cache, visibleCourseIds),
  };
}

export function hasNeeds(needs: Needs): boolean {
  return (
    needs.ranges.length > 0 ||
    Object.keys(needs.detailIds).length > 0 ||
    needs.undatedCourses.length > 0 ||
    needs.overrides ||
    needs.allCourses.length > 0 ||
    needs.statusCourses.length > 0
  );
}

export function uniqueRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const byKey = new Map(ranges.map((range) => [rangeKey(range), range]));
  return [...byKey.values()];
}

/** Everything a round learned. Maps replace or extend the cached maps key by key. */
export interface RoundUpdate {
  session: SessionData;
  planner: Record<string, PlannerEntry>;
  details: Record<string, Assignment>;
  undated: Record<string, Assignment[]>;
  /** `undefined`: the round did not load the override list. */
  overrides: PlannerOverride[] | undefined;
  gradeStatuses: Record<string, CustomGradeStatus[]>;
  limited: boolean;
  allAssignments: Record<string, Assignment[]>;
  /** The new skip list. Light and full rounds try every skipped request again. */
  skipped: string[];
  /** Courses whose assignment requests failed. An `ensure` round adds to the earlier list. */
  failedCourses: string[];
}

export interface RoundContext {
  api: CanvasApi;
  kind: RoundKind;
  /** The cache when the round starts. */
  cache: SessionCache;
  hiddenCourseIds: readonly string[];
  /** The planner ranges of the views in use, computed from the session data. */
  rangesFor(session: SessionData): TimeRange[];
  /** Epoch milliseconds. */
  now: number;
}

async function loadSession(api: CanvasApi): Promise<SessionData> {
  const [profile, courses, groups, colors, positions] = await Promise.all([
    api.getProfile(),
    api.listCourses(),
    api.listGroups(),
    api.getColors(),
    api.getDashboardPositions(),
  ]);
  return { profile, courses, groups, colors, positions };
}

interface PerCourseResult<T> {
  loaded: Record<string, T>;
  failed: string[];
  /** How many requests were sent. */
  sent: number;
  /** Course errors that hint at a Canvas outage, such as a 5xx. */
  outages: unknown[];
}

/**
 * Runs one request per course. A course-scoped failure skips that course; any other failure
 * fails the round.
 */
async function perCourse<T>(
  courseIds: readonly string[],
  load: (courseId: string) => Promise<T>,
): Promise<PerCourseResult<T>> {
  const outages: unknown[] = [];
  const results = await Promise.all(
    courseIds.map(async (courseId): Promise<[string, T | null]> => {
      try {
        return [courseId, await load(courseId)];
      } catch (error) {
        if (!isCourseScoped(error)) throw error;
        if (isOutageError(error)) outages.push(error);
        return [courseId, null];
      }
    }),
  );
  const loaded: Record<string, T> = {};
  const failed: string[] = [];
  for (const [courseId, value] of results) {
    if (value === null) failed.push(courseId);
    else loaded[courseId] = value;
  }
  return { loaded, failed, sent: courseIds.length, outages };
}

/**
 * A round that sent only per-course requests has no shared request to show that Canvas is down.
 * When every one of them failed with a server error, the round fails, so the list goes stale
 * instead of skipping every course.
 */
function throwOnOutage(results: readonly PerCourseResult<unknown>[]): void {
  const sent = results.reduce((sum, result) => sum + result.sent, 0);
  const outages = results.flatMap((result) => result.outages);
  if (sent > 0 && outages.length === sent) throw outages[0];
}

interface PlannerResult {
  limited: boolean;
  planner: Record<string, PlannerEntry>;
}

/**
 * Loads planner items. A 403 on a signed-in session means the school limits the planner:
 * `GET /api/v1/users/self` must still answer 200, or its error fails the round.
 */
async function loadPlanner(
  api: CanvasApi,
  ranges: readonly TimeRange[],
  now: number,
  self: () => Promise<UserSelf>,
): Promise<PlannerResult> {
  try {
    const lists = await Promise.all(ranges.map((range) => api.listPlannerItems(range)));
    const planner: Record<string, PlannerEntry> = {};
    ranges.forEach((range, index) => {
      planner[rangeKey(range)] = { range, items: lists[index] ?? [], loadedAt: now, usedAt: now };
    });
    return { limited: false, planner };
  } catch (error) {
    if (!isCanvasError(error, 'forbidden')) throw error;
    await self();
    return { limited: true, planner: {} };
  }
}

/**
 * The planner ranges a round loads. Light and full rounds load one range that covers every view
 * in use. An ensure round loads each view range that no cached entry covers.
 */
function plannerRanges(
  context: RoundContext,
  session: SessionData,
  retryPlanner: boolean,
): TimeRange[] {
  const all = uniqueRanges(context.rangesFor(session));
  if (context.cache.limited && !retryPlanner) return [];
  if (context.kind === 'ensure') {
    return all.filter((range) => coveringEntry(context.cache.planner, range) === null);
  }
  const span = spanOf(all);
  return span === null ? [] : [span];
}

function plannerItemsAfter(
  context: RoundContext,
  session: SessionData,
  fresh: Readonly<Record<string, PlannerEntry>>,
): PlannerItem[] {
  const entries = new Set<PlannerEntry>();
  for (const range of context.rangesFor(session)) {
    const entry = coveringEntry(fresh, range) ?? coveringEntry(context.cache.planner, range);
    if (entry !== null) entries.add(entry);
  }
  return [...entries].flatMap((entry) => entry.items);
}

/** Calls `load` once, on first use, and shares its promise. */
function shared<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    promise ??= load();
    return promise;
  };
}

/** Rejects with `UserChangedError` when Canvas answers for another user than the cached one. */
async function checkUser(self: () => Promise<UserSelf>, session: SessionData): Promise<void> {
  const user = await self();
  if (user.id !== session.profile.id) throw new UserChangedError();
}

/**
 * Fetches what the round needs. Rejects with the first error that is not course-scoped, or with
 * `UserChangedError` when another user is signed in.
 */
export async function runRound(context: RoundContext): Promise<RoundUpdate> {
  const { api, cache, kind } = context;
  const self = shared(() => api.getSelf());
  // A round that loads the session gets the user from the profile, so it needs no check.
  const userCheck =
    kind !== 'ensure' && cache.session !== null ? checkUser(self, cache.session) : null;
  const session = cache.session ?? (await loadSession(api));
  const skipped = kind === 'ensure' ? [...cache.skipped] : [];
  const failedCourses = new Set(kind === 'ensure' ? cache.failedCourses : []);
  const base = { ...cache, skipped };
  const hidden = new Set(context.hiddenCourseIds);
  const visible = session.courses.filter((course) => !hidden.has(course.id)).map((c) => c.id);

  const update: RoundUpdate = {
    session,
    planner: {},
    details: {},
    undated: {},
    overrides: undefined,
    gradeStatuses: {},
    limited: cache.limited,
    allAssignments: {},
    skipped,
    failedCourses: [],
  };
  const ranges =
    session.courses.length === 0 ? [] : plannerRanges(context, session, kind === 'full');
  const [planner] = await Promise.all([
    ranges.length > 0 ? loadPlanner(api, ranges, context.now, self) : null,
    userCheck,
  ]);
  if (session.courses.length === 0) return update;
  if (planner !== null) {
    update.limited = planner.limited;
    update.planner = planner.planner;
  }
  // Session data, planner items and the user check show that Canvas answers.
  const sentShared = cache.session === null || ranges.length > 0 || userCheck !== null;

  if (update.limited) {
    const courses =
      kind === 'ensure' && cache.limited
        ? missingCourses(visible, cache.allAssignments, base, skipKey.all)
        : visible;
    const reloadOverrides = kind !== 'ensure' || cache.overrides === null || !cache.limited;
    const [all, overrides] = await Promise.all([
      perCourse(courses, (courseId) => api.listAllAssignments(courseId)),
      reloadOverrides ? api.listPlannerOverrides() : Promise.resolve(undefined),
    ]);
    if (!sentShared && !reloadOverrides) throwOnOutage([all]);
    update.allAssignments = all.loaded;
    update.overrides = overrides;
    skipped.push(...all.failed.map(skipKey.all));
    all.failed.forEach((id) => failedCourses.add(id));
  } else {
    const items = plannerItemsAfter(context, session, update.planner);
    const lookup = assignmentIdsToLookup(items, context.hiddenCourseIds);
    const detailIds = kind === 'full' ? lookup : missingDetailIds(lookup, base);
    const undatedCourses =
      kind === 'full' ? visible : missingCourses(visible, cache.undated, base, skipKey.undated);
    const [details, undated] = await Promise.all([
      perCourse(Object.keys(detailIds), (courseId) =>
        api.listAssignmentsByIds(courseId, detailIds[courseId] ?? []),
      ),
      perCourse(undatedCourses, (courseId) => api.listUndatedAssignments(courseId)),
    ]);
    if (!sentShared) throwOnOutage([details, undated]);
    for (const list of Object.values(details.loaded)) {
      for (const assignment of list) update.details[assignment.id] = assignment;
    }
    // Ids that failed, or that Canvas left out of its answer, wait for the next refresh round.
    for (const [courseId, ids] of Object.entries(detailIds)) {
      const failed = details.failed.includes(courseId);
      const missing = ids.filter((id) => failed || update.details[id] === undefined);
      skipped.push(...missing.map(skipKey.details));
    }
    update.undated = undated.loaded;
    skipped.push(...undated.failed.map(skipKey.undated));
    [...details.failed, ...undated.failed].forEach((id) => failedCourses.add(id));

    const undatedAfter = { ...cache.undated, ...update.undated };
    const needed = overridesNeeded(false, undatedAfter, visible);
    if (needed && (kind === 'full' || cache.overrides === null)) {
      update.overrides = await api.listPlannerOverrides();
    }
  }

  const statusCourses = statusCoursesNeeded(
    {
      details: { ...cache.details, ...update.details },
      undated: { ...cache.undated, ...update.undated },
      allAssignments: update.limited ? { ...cache.allAssignments, ...update.allAssignments } : {},
      gradeStatuses: cache.gradeStatuses,
      skipped,
    },
    visible,
  );
  if (statusCourses.length > 0) {
    try {
      update.gradeStatuses = await api.listCustomGradeStatuses(statusCourses);
    } catch {
      // The names are optional: the chip then says "Teacher status". Try again next round.
      update.gradeStatuses = {};
    }
    const missing = statusCourses.filter((id) => update.gradeStatuses[id] === undefined);
    skipped.push(...missing.map(skipKey.statuses));
  }
  // Teacher status names are optional, so their failures are not course failures.
  update.failedCourses = [...failedCourses];
  return update;
}

/**
 * The cache after a successful round. Bookkeeping such as patches stays as it is. A new planner
 * entry replaces the older entries that it covers, because they hold older copies of its items.
 */
export function commitUpdate(cache: SessionCache, update: RoundUpdate, now: number): SessionCache {
  const planner = { ...cache.planner };
  for (const [key, entry] of Object.entries(update.planner)) {
    let usedAt = entry.usedAt;
    for (const [oldKey, old] of Object.entries(planner)) {
      if (oldKey !== key && !(oldKey in update.planner) && rangeCovers(entry.range, old.range)) {
        usedAt = Math.max(usedAt, old.usedAt);
        delete planner[oldKey];
      }
    }
    planner[key] = { ...entry, usedAt: Math.max(usedAt, cache.planner[key]?.usedAt ?? 0) };
  }
  const limitedChanged = update.limited !== cache.limited;
  return {
    ...cache,
    session: update.session,
    planner: update.limited ? {} : planner,
    details: { ...cache.details, ...update.details },
    undated: { ...cache.undated, ...update.undated },
    overrides: update.overrides ?? (limitedChanged ? null : cache.overrides),
    gradeStatuses: { ...cache.gradeStatuses, ...update.gradeStatuses },
    limited: update.limited,
    allAssignments: update.limited ? { ...cache.allAssignments, ...update.allAssignments } : {},
    skipped: update.skipped,
    failedCourses: update.failedCourses,
    lastSuccessAt: now,
    failure: null,
  };
}

/** The cache with every piece of Canvas data removed, for example after a sign-out. */
export function clearData(cache: SessionCache): SessionCache {
  return {
    ...cache,
    session: null,
    planner: {},
    details: {},
    undated: {},
    overrides: null,
    gradeStatuses: {},
    limited: false,
    allAssignments: {},
    skipped: [],
    failedCourses: [],
    lastSuccessAt: null,
    patches: [],
    undos: {},
    noteIds: {},
  };
}
