/**
 * The memory-only cache of Canvas data. See docs/design.md, decision 11.
 *
 * The cache lives in `storage.session`: the browser keeps it in memory, never writes it to
 * disk, and it survives a service worker restart. It holds the data of one Canvas origin.
 */
import type {
  Assignment,
  CanvasErrorKind,
  Colors,
  Course,
  CustomGradeStatus,
  DashboardPositions,
  Group,
  PlannerItem,
  PlannerOverride,
  Profile,
  TimeRange,
} from '../canvas/types';
import type { UndoInfo } from '../model/types';
import { defineItem } from '../platform/storage';
import type { OverrideFlags, OverrideTarget, Patch } from './patches';

export const CACHE_VERSION = 4;

/** Data that loads once per browser session. */
export interface SessionData {
  profile: Profile;
  courses: Course[];
  groups: Group[];
  colors: Colors;
  positions: DashboardPositions;
}

/** The planner items of one request range. */
export interface PlannerEntry {
  range: TimeRange;
  items: PlannerItem[];
  /** Epoch milliseconds. */
  loadedAt: number;
  /** Epoch milliseconds of the last view that used this range. */
  usedAt: number;
}

/** What failed: a refresh round, or a write of the student. */
export type FailureSource = 'round' | 'write';

export type Failure =
  /** Any 401, then `GET /api/v1/users/self` also returned 401. */
  | { kind: 'signed_out' }
  /**
   * A refresh or a write failed with a "Can't refresh" cause. The cause is kept for logs and
   * retries. A write failure does not stop the loads a view needs.
   */
  | {
      kind: 'stale';
      offline: boolean;
      cause: CanvasErrorKind | 'unknown';
      at: number;
      source: FailureSource;
    };

export type RoundScope = 'light' | 'full';

/** The facts the 60-second refresh limit needs. */
export interface RoundLimits {
  /** Epoch milliseconds when the last light or full round started. */
  lastRoundAt: number | null;
  lastRoundScope: RoundScope | null;
  /** Epoch milliseconds when the last full round started. */
  lastFullAt: number | null;
}

/** One item of an undoable override write, with its flags from before the write. */
export interface UndoEntry {
  key: string;
  target: OverrideTarget;
  previous: OverrideFlags;
}

export type UndoRecord =
  | { kind: 'overrides'; entries: UndoEntry[] }
  /**
   * A delayed task delete. The DELETE is sent when the Undo notice ends, and at the latest
   * when its patch's `deleteAt` comes. Undo drops the patch before the DELETE starts.
   */
  | { kind: 'delete'; patchId: number };

/**
 * An undo record. It has no time limit: it stays until its Undo notice ends, so keyboard and
 * screen reader users have the time they need (decision 6).
 */
export interface StoredUndo {
  record: UndoRecord;
  /** What the Undo notice says. A ready state reports it while the notice still applies. */
  info: UndoInfo;
  /** Epoch milliseconds when the action ran. The oldest records go first past the cap. */
  createdAt: number;
}

export interface SessionCache {
  version: typeof CACHE_VERSION;
  origin: string;
  session: SessionData | null;
  /** Planner items keyed by `rangeKey`. */
  planner: Record<string, PlannerEntry>;
  /** Assignment details keyed by assignment id. Hand-in types rarely change, so they stay all session. */
  details: Record<string, Assignment>;
  /** Undated work keyed by course id. A missing key means the course was never loaded. */
  undated: Record<string, Assignment[]>;
  /** `null` until the override list loads. */
  overrides: PlannerOverride[] | null;
  /** Teacher status names keyed by course id. Loaded once per course per session. */
  gradeStatuses: Record<string, CustomGradeStatus[]>;
  /** The Canvas planner is turned off for the student (Limited Access for Students). */
  limited: boolean;
  /** Limited mode only: all assignments keyed by course id. */
  allAssignments: Record<string, Assignment[]>;
  /**
   * Requests that failed for one course only, such as `details:<assignment id>` or
   * `undated:<course id>`. They are not tried again until the next refresh round.
   */
  skipped: string[];
  /** Courses whose requests failed in the last round. The list shows a short note for them. */
  failedCourses: string[];
  /** Epoch milliseconds of the last successful round. */
  lastSuccessAt: number | null;
  failure: Failure | null;
  limits: RoundLimits;
  /** Writes applied on top of the Canvas data until a later round confirms them. */
  patches: Patch[];
  /**
   * Undo records by token. They live here, in `storage.session`, so an Undo click still works
   * after a service worker restart.
   */
  undos: Record<string, StoredUndo>;
  /** Real ids of custom tasks that were created, keyed by their temporary id. */
  noteIds: Record<string, string>;
  /** The next id for patches, temporary note ids and undo tokens. */
  nextId: number;
}

export function emptyCache(origin: string): SessionCache {
  return {
    version: CACHE_VERSION,
    origin,
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
    failure: null,
    limits: { lastRoundAt: null, lastRoundScope: null, lastFullAt: null },
    patches: [],
    undos: {},
    noteIds: {},
    nextId: 1,
  };
}

/** Whether a stored value is a cache this version can read. */
export function isSessionCache(value: unknown): value is SessionCache {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === CACHE_VERSION &&
    typeof (value as { origin?: unknown }).origin === 'string'
  );
}

/** The key of a planner range in `SessionCache.planner`. */
export function rangeKey(range: TimeRange): string {
  return `${range.start}/${range.end}`;
}

/** Whether `outer` covers every instant of `inner`. Instants are compared by value. */
export function rangeCovers(outer: TimeRange, inner: TimeRange): boolean {
  return (
    Date.parse(outer.start) <= Date.parse(inner.start) &&
    Date.parse(outer.end) >= Date.parse(inner.end)
  );
}

/** The range from the earliest start to the latest end of the ranges. */
export function spanOf(ranges: readonly TimeRange[]): TimeRange | null {
  let span: TimeRange | null = null;
  for (const range of ranges) {
    if (span === null) {
      span = range;
      continue;
    }
    span = {
      start: Date.parse(range.start) < Date.parse(span.start) ? range.start : span.start,
      end: Date.parse(range.end) > Date.parse(span.end) ? range.end : span.end,
    };
  }
  return span;
}

/**
 * The cached planner entry that holds every item of the range: the exact entry, else the newest
 * entry that covers the range. `null` when no entry covers it.
 */
export function coveringEntry(
  planner: Readonly<Record<string, PlannerEntry>>,
  range: TimeRange,
): PlannerEntry | null {
  const exact = planner[rangeKey(range)];
  if (exact !== undefined) return exact;
  const covering = Object.values(planner)
    .filter((entry) => rangeCovers(entry.range, range))
    .sort((a, b) => b.loadedAt - a.loadedAt);
  return covering[0] ?? null;
}

/**
 * How many planner ranges the cache keeps. A light or full round loads one range that covers
 * every view in use, so a few entries are enough.
 */
export const MAX_PLANNER_ENTRIES = 4;

/** Keeps the most recently used planner ranges. */
export function prunePlanner(
  planner: Readonly<Record<string, PlannerEntry>>,
  keep: number = MAX_PLANNER_ENTRIES,
): Record<string, PlannerEntry> {
  const entries = Object.entries(planner).sort(([, a], [, b]) => b.usedAt - a.usedAt);
  return Object.fromEntries(entries.slice(0, keep));
}

/**
 * The address form, a setup check in progress, or its result. Every `origin` here passed
 * `normalizeAddress`, so only a usable https origin is ever checked again.
 */
export type SetupStatus =
  /** The student opened the address form. The saved address stays until a new one passes. */
  | { kind: 'entering' }
  | { kind: 'checking'; origin: string }
  | { kind: 'redirects'; origin: string }
  | { kind: 'not_canvas'; origin: string }
  /** The check failed at the network level, such as a wrong host name. Retry checks again. */
  | { kind: 'unreachable'; origin: string }
  /** The typed text is not a usable address. It is kept for display only, never checked. */
  | { kind: 'rejected'; text: string };

/** The address a setup status is about, or `null` when it has none to check. */
export function setupStatusOrigin(status: SetupStatus | null): string | null {
  if (status === null) return null;
  switch (status.kind) {
    case 'entering':
    case 'rejected':
      return null;
    case 'checking':
    case 'redirects':
    case 'not_canvas':
    case 'unreachable':
      return status.origin;
  }
}

/** Whether a stored value is a setup status this version can read. */
export function isSetupStatus(value: unknown): value is SetupStatus {
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as { kind?: unknown; origin?: unknown; text?: unknown };
  switch (fields.kind) {
    case 'entering':
      return true;
    case 'rejected':
      return typeof fields.text === 'string';
    case 'checking':
    case 'redirects':
    case 'not_canvas':
    case 'unreachable':
      return typeof fields.origin === 'string';
    default:
      return false;
  }
}

/** The cache item in `storage.session`. */
export const sessionCacheItem = defineItem<SessionCache | null>('session:weekrowCache', () => null);

/** The setup status item in `storage.session`, so a service worker restart keeps it. */
export const setupStatusItem = defineItem<SetupStatus | null>('session:weekrowSetup', () => null);
