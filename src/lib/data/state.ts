/**
 * Builds what a surface shows from the cache. Pure: no I/O and no clock.
 * See docs/design.md, decisions 6 to 9 and 11.
 */
import type { Course, DashboardPositions, PlannerItem, TimeRange } from '../canvas/types';
import {
  buildWeekView,
  collectItems,
  plannerRangeFor,
  resolveViewBasics,
  weekBounds,
  type Item,
  type ModelInput,
  type Offer,
  type Settings,
  type WeekView,
} from '../model';
import {
  coveringEntry,
  rangeCovers,
  type PlannerEntry,
  type SessionCache,
  type SessionData,
} from './cache';
import { applyPatches } from './patches';
import type { CourseChoice, RequestSurface, SurfaceRequest } from './protocol';

/** Facts about the browser and the moment, the same for every view. */
export interface ViewContext {
  origin: string;
  /** Epoch milliseconds. */
  now: number;
  settings: Settings;
  browserTimeZone: string;
  browserLanguage: string | null;
}

export function isoInstant(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

type BasicsInput = Pick<
  ModelInput,
  'now' | 'profile' | 'settings' | 'browserTimeZone' | 'browserLanguage' | 'weekOffset' | 'courses'
>;

function basicsInput(session: SessionData, weekOffset: number, context: ViewContext): BasicsInput {
  return {
    now: isoInstant(context.now),
    profile: session.profile,
    settings: context.settings,
    browserTimeZone: context.browserTimeZone,
    browserLanguage: context.browserLanguage,
    weekOffset,
    courses: session.courses,
  };
}

/** The Canvas time zone, resolved as the model does. */
export function canvasTimeZone(session: SessionData, context: ViewContext): string {
  return resolveViewBasics(basicsInput(session, 0, context)).timeZone;
}

/** The planner request range of a view. */
export function plannerRangeForView(
  session: SessionData,
  weekOffset: number,
  context: ViewContext,
): TimeRange {
  return plannerRangeFor(basicsInput(session, weekOffset, context));
}

/** The instants of the viewed week, both ends included. */
export function weekRange(
  session: SessionData,
  weekOffset: number,
  context: ViewContext,
): TimeRange {
  const input = basicsInput(session, weekOffset, context);
  const { timeZone, weekStartDay } = resolveViewBasics(input);
  const bounds = weekBounds({ now: input.now, timeZone, weekStartDay, weekOffset });
  return { start: bounds.start, end: isoInstant(Date.parse(bounds.end) - 1) };
}

export interface PickedEntry {
  entry: PlannerEntry;
  /** The entry covers the whole planner range of the view, from the horizon on. */
  complete: boolean;
}

/**
 * The cached planner items for a view: an entry that covers its whole planner range, or else the
 * newest entry that covers the viewed week, such as the range from before midnight or before a
 * settings change. The second kind may lack older past-due items, so it is not complete.
 */
export function pickPlannerEntry(
  cache: Pick<SessionCache, 'planner'>,
  range: TimeRange,
  week: TimeRange,
): PickedEntry | null {
  const full = coveringEntry(cache.planner, range);
  if (full !== null) return { entry: full, complete: true };
  const covering = Object.values(cache.planner)
    .filter((entry) => rangeCovers(entry.range, week))
    .sort((a, b) => b.loadedAt - a.loadedAt);
  const entry = covering[0];
  return entry === undefined ? null : { entry, complete: false };
}

function position(positions: DashboardPositions, courseId: string): number {
  return positions.dashboard_positions[`course_${courseId}`] ?? Number.POSITIVE_INFINITY;
}

/** Courses in dashboard order, then by name. */
export function courseChoices(
  courses: readonly Course[],
  positions: DashboardPositions,
  hiddenCourseIds: readonly string[] = [],
): CourseChoice[] {
  const hidden = new Set(hiddenCourseIds);
  return courses
    .filter((course) => !hidden.has(course.id))
    .sort(
      (a, b) =>
        position(positions, a.id) - position(positions, b.id) || a.name.localeCompare(b.name),
    )
    .map((course) => ({ id: course.id, name: course.name }));
}

function visibleUndated(cache: SessionCache) {
  return cache.limited ? [] : Object.values(cache.undated).flat();
}

/** The short name of a course for a one-line note: its trimmed Canvas code, or its name. */
export function courseShortName(course: Course): string {
  const code = course.course_code?.trim();
  return code ? code : course.name;
}

/**
 * The courses to name in the "Couldn't load" note, in dashboard order. Hidden courses never
 * show, and a course home page names only its own course.
 */
export function skippedCourseChoices(
  session: Pick<SessionData, 'courses' | 'positions'>,
  failedCourseIds: readonly string[],
  hiddenCourseIds: readonly string[],
  scopeCourseId: string | null,
): CourseChoice[] {
  const failed = new Set(failedCourseIds);
  const byId = new Map(session.courses.map((course) => [course.id, course]));
  return courseChoices(
    session.courses.filter(
      (course) => failed.has(course.id) && (scopeCourseId === null || course.id === scopeCourseId),
    ),
    session.positions,
    hiddenCourseIds,
  ).map(({ id }) => {
    const course = byId.get(id);
    return { id, name: course === undefined ? id : courseShortName(course) };
  });
}

/** The model input for a view, with the pending writes applied. */
export function modelInputFor(
  cache: SessionCache,
  session: SessionData,
  plannerItems: readonly PlannerItem[],
  request: SurfaceRequest,
  context: ViewContext,
): ModelInput {
  const patched = applyPatches({ plannerItems, overrides: cache.overrides }, cache.patches, {
    courses: session.courses,
    userId: session.profile.id,
  });
  return {
    ...basicsInput(session, request.weekOffset, context),
    origin: context.origin,
    courseFilter: request.courseFilter,
    scopeCourseId: request.scopeCourseId,
    groups: session.groups,
    colors: session.colors,
    positions: session.positions,
    plannerItems: [...patched.plannerItems],
    assignmentDetails: cache.details,
    undatedAssignments: visibleUndated(cache),
    overrides: [...(patched.overrides ?? [])],
    customGradeStatuses: cache.gradeStatuses,
    limited: cache.limited,
    allAssignments: cache.limited ? Object.values(cache.allAssignments).flat() : [],
  };
}

export interface ViewResult {
  view: WeekView;
  /** The planner items cover the whole planner range of the view. */
  exact: boolean;
}

/**
 * Whether a course filter still makes sense: the rings are on, and the course is still in the
 * list, as a visible course or through a ring or an item of the filtered view.
 */
export function courseFilterApplies(
  filter: string | null,
  view: WeekView,
  session: Pick<SessionData, 'courses'>,
  settings: Settings,
): boolean {
  if (!settings.showRings) return false;
  if (filter === null) return true;
  const hidden = settings.hiddenCourseIds.includes(filter);
  if (!hidden && session.courses.some((course) => course.id === filter)) return true;
  return (
    view.rings.some((ring) => ring.courseId === filter) ||
    view.groups.some((group) =>
      [...group.items, ...group.older, ...group.skipped, ...group.doneUndated].some(
        (item) => item.courseId === filter,
      ),
    )
  );
}

/**
 * The week view for a request, or `null` when no cached planner items cover it yet.
 * A course filter that no longer applies is dropped, so the view's `courseFilter` is then
 * `undefined` and the surface clears its own filter.
 */
export function viewFor(
  cache: SessionCache,
  session: SessionData,
  request: SurfaceRequest,
  context: ViewContext,
): ViewResult | null {
  const result = viewForRequest(cache, session, request, context);
  const filter = request.courseFilter;
  if (result === null || filter === undefined) return result;
  if (courseFilterApplies(filter, result.view, session, context.settings)) return result;
  return viewForRequest(cache, session, { ...request, courseFilter: undefined }, context);
}

function viewForRequest(
  cache: SessionCache,
  session: SessionData,
  request: SurfaceRequest,
  context: ViewContext,
): ViewResult | null {
  if (cache.limited) {
    return {
      view: buildWeekView(modelInputFor(cache, session, [], request, context)),
      exact: true,
    };
  }
  const range = plannerRangeForView(session, request.weekOffset, context);
  const picked = pickPlannerEntry(cache, range, weekRange(session, request.weekOffset, context));
  if (picked === null) return null;
  return {
    view: buildWeekView(modelInputFor(cache, session, picked.entry.items, request, context)),
    exact: picked.complete,
  };
}

/** Every item the cache knows, with the pending writes applied. Recent ranges win. */
export function allItems(cache: SessionCache, session: SessionData, context: ViewContext): Item[] {
  const entries = Object.values(cache.planner).sort((a, b) => b.usedAt - a.usedAt);
  const plannerItems = entries.flatMap((entry) => entry.items);
  const input = modelInputFor(
    cache,
    session,
    plannerItems,
    { surface: 'panel', weekOffset: 0, scopeCourseId: null },
    context,
  );
  return collectItems({
    ...input,
    userId: session.profile.id,
    courses: session.courses,
    hiddenCourseIds: [],
  });
}

/** The offer to show: never one for the saved address. */
export function visibleOffer(offer: Offer | null, savedOrigin: string | null): Offer | null {
  return offer !== null && offer.origin === savedOrigin ? null : offer;
}

/**
 * The offer for a surface. Only the side panel shows it (decision 4): the in-page list lives on
 * the saved Canvas page, where page scripts could read it, and the welcome page has its own form.
 */
export function offerForSurface(
  offer: Offer | null,
  savedOrigin: string | null,
  surface: RequestSurface,
): Offer | null {
  return surface === 'panel' ? visibleOffer(offer, savedOrigin) : null;
}
