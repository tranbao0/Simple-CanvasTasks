/**
 * Domain model and view model. See docs/design.md, decisions 6 to 9 and 18.
 *
 * Plain dates (`YYYY-MM-DD`) are calendar days in the student's Canvas time zone.
 * Instants are ISO 8601 strings in UTC.
 */
import type {
  Assignment,
  Colors,
  Course,
  CustomGradeStatus,
  DashboardPositions,
  Group,
  LatePolicyStatus,
  PlannableType,
  PlannerItem,
  PlannerOverride,
  Profile,
} from '../canvas/types';

/** ISO day of week: 1 is Monday, 7 is Sunday. */
export type IsoDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Settings {
  /** `auto` takes the first day of the week from the Canvas language. */
  weekStart: 'auto' | IsoDayOfWeek;
  hiddenCourseIds: string[];
  showRings: boolean;
  showOnCanvasPages: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  weekStart: 'auto',
  hiddenCourseIds: [],
  showRings: true,
  showOnCanvasPages: true,
};

export type ItemKind =
  'assignment' | 'quiz' | 'discussion' | 'page' | 'note' | 'peer_review' | 'checkpoint';

/** How the student hands the work in. `none` means there is nothing to hand in. */
export type HandIn = 'canvas' | 'outside' | 'none';

/** What Canvas knows about the student's work. `undefined` means not loaded yet. */
export interface CanvasFacts {
  submitted: boolean;
  excused: boolean;
  graded: boolean;
  missing: boolean;
  redoRequest: boolean;
  /** Peer reviews only. */
  peerReviewCompleted: boolean;
  latePolicyStatus: LatePolicyStatus | undefined;
  customGradeStatusId: string | null | undefined;
  lockAt: string | null | undefined;
  unlockAt: string | null | undefined;
  lockedForUser: boolean | undefined;
}

export interface OverrideRef {
  id: string;
  markedComplete: boolean;
  dismissed: boolean;
}

/** One normalized piece of work, before its state and chips are computed. */
export interface Item {
  /** `assignment:<id>` for assignment-backed items, otherwise `<plannable_type>:<plannable_id>`. */
  key: string;
  kind: ItemKind;
  plannableType: PlannableType;
  plannableId: string;
  assignmentId: string | null;
  title: string;
  /** For checkpoints: `reply_to_topic` or `reply_to_entry`. */
  subtitleTag: string | null;
  /** `null` for a custom task with no course. Group items of unknown courses use `group_<id>`. */
  courseId: string | null;
  /** Course or group name to show. The UI shows its own "Personal" text when `courseId` is null. */
  contextLabel: string;
  /** CSS color of the course, by the same rule as `Ring.color`. */
  color: string;
  /** Instant, or `null` when undated. */
  due: string | null;
  points: number | null;
  /** Absolute URL on the saved Canvas origin, or `null` for custom tasks. */
  url: string | null;
  /** `null` until the assignment details are loaded. */
  handIn: HandIn | null;
  /** Host-derived tool name such as "Gradescope", for `outside` work handed in through a tool. */
  toolName: string | null;
  /** `on_paper` assignments. */
  onPaper: boolean;
  /** An assignment with nothing to hand in. Shows only on its day. */
  isReminder: boolean;
  override: OverrideRef | null;
  facts: CanvasFacts;
  /** Planner note id for custom tasks. */
  noteId: string | null;
  noteDetails: string | null;
}

export type ItemState = 'done' | 'skipped' | 'open';

/** At most one per item that is not done. Decision 7, in priority order. */
export type StatusChip =
  | { kind: 'skipped' }
  | { kind: 'redo_requested' }
  | { kind: 'missing' }
  | { kind: 'teacher_status'; name: string | null }
  | { kind: 'extended' }
  | { kind: 'cant_confirm'; tool: string | null; onPaper: boolean }
  | { kind: 'past_due' };

export type Availability = { kind: 'opens'; at: string } | { kind: 'closed' } | null;

export type HandInChip =
  /** `name` is null when the tool has no readable name; the UI then shows its own text. */
  { kind: 'tool'; name: string | null } | { kind: 'on_paper' } | { kind: 'no_hand_in' } | null;

/** Chips on done items. `missing_in_canvas` and `redo_requested` are warnings. */
export type DoneChip =
  | { kind: 'missing_in_canvas'; teacherSet: boolean }
  | { kind: 'redo_requested' }
  | { kind: 'excused' };

export interface ItemView extends Item {
  state: ItemState;
  chip: StatusChip | null;
  availability: Availability;
  handInChip: HandInChip;
  doneChips: DoneChip[];
  hasWarning: boolean;
  /** Work handed in on Canvas with a redo request. */
  checkboxDisabled: boolean;
  canSkip: boolean;
  /** A custom task with a past date. */
  canMoveToToday: boolean;
  /** Shown in Tomorrow from the next week. Not counted in this week's rings. */
  isLookAhead: boolean;
}

export type GroupKind = 'past_due' | 'today' | 'tomorrow' | 'day' | 'no_due_date' | 'done';

export interface ListGroup {
  kind: GroupKind;
  /** Plain date for `today`, `tomorrow` and `day`. */
  date: string | null;
  /** Items shown in full. */
  items: ItemView[];
  /** `past_due` only: items older than 7 days, collapsed under "N older". */
  older: ItemView[];
  /** `past_due` and `no_due_date`: skipped items, behind "N skipped". */
  skipped: ItemView[];
  /** `no_due_date` only: done undated items, behind "N done". */
  doneUndated: ItemView[];
  /** `done` only: done items with a warning chip. */
  warningCount: number;
  collapsedByDefault: boolean;
}

export interface Ring {
  /** `null` is the "Personal" ring. The UI shows its own "Personal" text for it. */
  courseId: string | null;
  label: string;
  /** Short label such as the Canvas course code, or the label when there is none. */
  shortLabel: string;
  /** CSS color. */
  color: string;
  done: number;
  total: number;
  /** Items of this course in Past due. */
  pastDue: number;
}

export interface WeekView {
  /** First day of the viewed week, plain date. */
  weekStart: string;
  /** Last day of the viewed week, plain date. */
  weekEnd: string;
  /** 0 is the current week. */
  weekOffset: number;
  isCurrentWeek: boolean;
  /** Plain date of today in the Canvas time zone. */
  today: string;
  timeZone: string;
  browserTimeZoneDiffers: boolean;
  /** Canvas `effective_locale`. */
  locale: string;
  hourCycle: 'h12' | 'h23';
  groups: ListGroup[];
  /** Empty when the rings setting is off. */
  rings: Ring[];
  /**
   * `undefined`: no filter. `null`: the Personal ring. Also `undefined` when the data owner dropped
   * a filter that no longer applies (rings off, course hidden or gone), so the surface clears its own.
   */
  courseFilter: string | null | undefined;
  hiddenCourseCount: number;
  /** The week has no items. The day groups are replaced by "Nothing due this week". */
  nothingDue: boolean;
  /** The Canvas planner is turned off for the student. */
  limited: boolean;
  /** Set when the view is limited to one course, such as a course home page. */
  scopeCourseId: string | null;
  /** The scoped course is hidden in the settings, so the surface shows a note instead of the list. */
  scopeCourseHidden: boolean;
}

/** Everything `buildWeekView` needs. The model is pure: no I/O, no clock, no globals. */
export interface ModelInput {
  origin: string;
  /** Instant. */
  now: string;
  /** IANA time zone of the browser, to decide the time zone label. */
  browserTimeZone: string;
  /** Browser UI language, the last fallback for the Canvas language. */
  browserLanguage?: string | null;
  profile: Profile;
  settings: Settings;
  weekOffset: number;
  courseFilter?: string | null | undefined;
  scopeCourseId?: string | null;
  courses: Course[];
  groups: Group[];
  colors: Colors;
  positions: DashboardPositions;
  plannerItems: PlannerItem[];
  /** Assignment details keyed by assignment id. */
  assignmentDetails: Record<string, Assignment>;
  undatedAssignments: Assignment[];
  /** Used to find done marks of undated items and, in limited mode, of all items. */
  overrides: PlannerOverride[];
  /** Keyed by course id. */
  customGradeStatuses: Record<string, CustomGradeStatus[]>;
  limited: boolean;
  /** Limited mode only: all assignments of the visible courses. */
  allAssignments: Assignment[];
}

/** Offer shown when the panel opens on a Canvas tab that is not the saved address. */
export interface Offer {
  origin: string;
  mode: 'use' | 'switch';
}

/**
 * The Undo notice. It stays until the student acts again, closes it, or the surface goes away.
 * It has no timer, so keyboard and screen reader users can reach it.
 */
export interface UndoInfo {
  kind: 'done' | 'skipped' | 'skipped_all' | 'deleted';
  count: number;
}

export type SurfaceState =
  | { kind: 'loading' }
  /**
   * `savedOrigin` is set while the student changes the address: the old one stays saved until a new
   * one passes the check, and the form offers "Keep using" as a cancel.
   */
  | { kind: 'not_set_up'; offer: Offer | null; savedOrigin: string | null }
  /** `savedOrigin` is the address still saved while the student checks a different one. */
  | { kind: 'checking'; origin: string; savedOrigin: string | null }
  | { kind: 'no_access'; origin: string; savedOrigin: string | null; offer: Offer | null }
  | { kind: 'redirects'; origin: string; savedOrigin: string | null }
  | { kind: 'not_canvas'; origin: string; savedOrigin: string | null }
  /** The setup check of a typed address failed at the network level, such as a wrong host name. */
  | { kind: 'unreachable'; origin: string; savedOrigin: string | null }
  | { kind: 'signed_out'; origin: string; isFirefox: boolean; offer: Offer | null }
  | { kind: 'no_courses'; origin: string; offer: Offer | null }
  /** A refresh failed and no data is cached. */
  | {
      kind: 'cant_load';
      origin: string;
      offline: boolean;
      savedOrigin: string | null;
      offer: Offer | null;
    }
  | {
      kind: 'ready';
      origin: string;
      view: WeekView;
      /** Set when the last refresh failed. `since` is the instant of the shown data. */
      stale: { since: string; offline: boolean } | null;
      refreshing: boolean;
      offer: Offer | null;
      undo: UndoInfo | null;
      /** One-time notes the student has already seen. */
      seenNotes: { firstDone: boolean; firstSkip: boolean };
      /** Courses for the task form, not hidden. */
      taskCourses: { id: string; name: string }[];
      /**
       * Courses whose requests failed in the last round. The list shows a short note for them.
       * `name` is the short label: the trimmed course code, else the course name.
       */
      skippedCourses: { id: string; name: string }[];
    };
