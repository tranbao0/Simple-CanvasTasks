/**
 * Runtime messages between the surfaces and the data owner in the background.
 * See docs/design.md, decision 11.
 *
 * Surfaces never fetch Canvas. They ask the background for their state, send refresh requests
 * and actions, and learn about new data from the change marker in `storage.local`.
 * The panel presence messages live in src/lib/platform/messages.ts.
 */
import type { SurfaceState, UndoInfo } from '../model/types';
import type { SurfaceKind, TaskInput } from '../ui/contract';

/** The extension page or surface that asks. `page` is the welcome page. */
export type RequestSurface = SurfaceKind | 'page';

/** The view a surface shows. */
export interface SurfaceRequest {
  surface: RequestSurface;
  /** 0 is the current week. */
  weekOffset: number;
  /** Missing or `undefined`: no filter. `null`: the Personal ring. */
  courseFilter?: string | null;
  /** The course of a course home page, or `null`. */
  scopeCourseId: string | null;
  /**
   * The token of the Undo notice the surface shows, if any. A ready reply then carries the
   * notice in `undo` while its record lives, and `null` once the record is gone, for example
   * after the student signed out or another user signed in.
   */
  undoToken?: string | null;
}

/**
 * Why a surface asks for a refresh.
 * - `visible`: the surface started or became visible again.
 * - `timer`: the 5-minute timer.
 * - `midnight`: a new day started in the Canvas time zone.
 * - `retry`: the student clicked Retry.
 * - `settings`: the student changed a setting.
 */
export type RefreshReason = 'visible' | 'timer' | 'midnight' | 'retry' | 'settings';

export type SeenNote = 'firstDone' | 'firstSkip';

export type DataAction =
  | { kind: 'setDone'; key: string; done: boolean }
  | { kind: 'skip'; key: string }
  | { kind: 'unskip'; key: string }
  /** Skips every item in the "N older" list of the view. */
  | { kind: 'skipAllOlder'; request: SurfaceRequest }
  | { kind: 'undo'; token: string }
  | { kind: 'createTask'; input: TaskInput }
  | { kind: 'updateTask'; noteId: string; input: TaskInput }
  | { kind: 'deleteTask'; noteId: string }
  | { kind: 'moveTaskToToday'; noteId: string }
  | { kind: 'markNoteSeen'; note: SeenNote }
  | { kind: 'dismissOffer' }
  /** Leaves the address form or a check of a new address, and goes back to the saved address. */
  | { kind: 'keepSavedAddress' }
  /**
   * Ends an Undo notice: the student closed it or acted again, or the surface went away.
   * The undo record goes, and a pending task delete is sent then.
   */
  | { kind: 'endUndo'; token: string };

export type DataActionKind = DataAction['kind'];

/** Asks for the state of one view. The reply is a `SurfaceState`. */
export interface GetStateMessage {
  type: 'weekrow:get-state';
  request: SurfaceRequest;
}

/** The reply is a `RefreshReply`. */
export interface RefreshMessage {
  type: 'weekrow:refresh';
  reason: RefreshReason;
  /** Retry applies to what this surface shows: the in-page list never checks a new address. */
  surface: RequestSurface;
}

/** The reply is an `ActionReply`. */
export interface ActionMessage {
  type: 'weekrow:action';
  action: DataAction;
}

/**
 * Sent from an extension page after `permissions.request` resolved with a grant.
 * The background checks the address and saves it when it is Canvas. The reply is an `OkReply`.
 */
export interface SetupMessage {
  type: 'weekrow:setup';
  origin: string;
  /** The student accepted the "Use this Canvas?" or "Switch to this Canvas?" offer. */
  fromOffer: boolean;
}

/**
 * Opens the address form. The saved address stays until a new one passes the check, and the
 * form offers "Keep using" as a cancel. The reply is an `OkReply`.
 */
export interface ChangeAddressMessage {
  type: 'weekrow:change-address';
}

/** Asks for all active student courses, hidden ones included. The reply is a `CoursesReply`. */
export interface CoursesMessage {
  type: 'weekrow:courses';
}

/** Content scripts cannot open extension pages, so they ask the background. */
export interface OpenPageMessage {
  type: 'weekrow:open-page';
  page: 'settings' | 'welcome';
}

/**
 * Content script to background: this `instructure.com` page is Canvas. The background saves the
 * page origin only when no address is saved yet, the sender page has that origin, and it is not
 * a test or beta host (decision 5). The reply is a `CanvasDetectedReply`.
 */
export interface CanvasDetectedMessage {
  type: 'weekrow:canvas-detected';
  origin: string;
}

export type DataMessage =
  | GetStateMessage
  | RefreshMessage
  | ActionMessage
  | SetupMessage
  | ChangeAddressMessage
  | CoursesMessage
  | OpenPageMessage
  | CanvasDetectedMessage;

export interface OkReply {
  ok: true;
}

export interface RefreshReply {
  ok: true;
  /**
   * Epoch milliseconds when a full round that the 60-second limit put off can run. A visible
   * surface then asks again with its timer, because the background can stop before then.
   */
  retryAt: number | null;
}

export interface CanvasDetectedReply {
  /** The saved address after the message. */
  origin: string | null;
}

export interface UndoTicket {
  token: string;
  info: UndoInfo;
}

export interface ActionReply {
  /** Set when the action can be undone. The Undo notice ends with an `endUndo` action. */
  undo: UndoTicket | null;
}

export interface CourseChoice {
  id: string;
  name: string;
}

export interface CoursesReply {
  courses: CourseChoice[];
}

export const OK_REPLY: OkReply = { ok: true };

type Fields = Record<string, unknown>;

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null;
}

function hasType(value: unknown, type: string): value is Fields {
  return isObject(value) && value['type'] === type;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

const REQUEST_SURFACES: readonly string[] = ['panel', 'inpage', 'page'];
const REFRESH_REASONS: readonly string[] = ['visible', 'timer', 'midnight', 'retry', 'settings'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export function isSurfaceRequest(value: unknown): value is SurfaceRequest {
  if (!isObject(value)) return false;
  const filter = value['courseFilter'];
  return (
    isString(value['surface']) &&
    REQUEST_SURFACES.includes(value['surface']) &&
    Number.isInteger(value['weekOffset']) &&
    (filter === undefined || isStringOrNull(filter)) &&
    isStringOrNull(value['scopeCourseId']) &&
    (value['undoToken'] === undefined || isStringOrNull(value['undoToken']))
  );
}

export function isTaskInput(value: unknown): value is TaskInput {
  if (!isObject(value)) return false;
  const time = value['time'];
  return (
    isNonEmptyString(value['title']) &&
    isString(value['date']) &&
    DATE_PATTERN.test(value['date']) &&
    (time === null || (isString(time) && TIME_PATTERN.test(time))) &&
    isStringOrNull(value['courseId']) &&
    isStringOrNull(value['details'])
  );
}

function isSeenNote(value: unknown): value is SeenNote {
  return value === 'firstDone' || value === 'firstSkip';
}

export function isDataAction(value: unknown): value is DataAction {
  if (!isObject(value) || !isString(value['kind'])) return false;
  const kind = value['kind'] as DataActionKind;
  switch (kind) {
    case 'setDone':
      return isNonEmptyString(value['key']) && typeof value['done'] === 'boolean';
    case 'skip':
    case 'unskip':
      return isNonEmptyString(value['key']);
    case 'skipAllOlder':
      return isSurfaceRequest(value['request']);
    case 'undo':
    case 'endUndo':
      return isNonEmptyString(value['token']);
    case 'createTask':
      return isTaskInput(value['input']);
    case 'updateTask':
      return isNonEmptyString(value['noteId']) && isTaskInput(value['input']);
    case 'deleteTask':
    case 'moveTaskToToday':
      return isNonEmptyString(value['noteId']);
    case 'markNoteSeen':
      return isSeenNote(value['note']);
    case 'dismissOffer':
    case 'keepSavedAddress':
      return true;
    default:
      return false;
  }
}

export function isGetStateMessage(value: unknown): value is GetStateMessage {
  return hasType(value, 'weekrow:get-state') && isSurfaceRequest(value['request']);
}

export function isRefreshMessage(value: unknown): value is RefreshMessage {
  return (
    hasType(value, 'weekrow:refresh') &&
    isString(value['reason']) &&
    REFRESH_REASONS.includes(value['reason']) &&
    isString(value['surface']) &&
    REQUEST_SURFACES.includes(value['surface'])
  );
}

export function isActionMessage(value: unknown): value is ActionMessage {
  return hasType(value, 'weekrow:action') && isDataAction(value['action']);
}

export function isSetupMessage(value: unknown): value is SetupMessage {
  return (
    hasType(value, 'weekrow:setup') &&
    isNonEmptyString(value['origin']) &&
    typeof value['fromOffer'] === 'boolean'
  );
}

export function isChangeAddressMessage(value: unknown): value is ChangeAddressMessage {
  return hasType(value, 'weekrow:change-address');
}

export function isCoursesMessage(value: unknown): value is CoursesMessage {
  return hasType(value, 'weekrow:courses');
}

export function isOpenPageMessage(value: unknown): value is OpenPageMessage {
  return (
    hasType(value, 'weekrow:open-page') &&
    (value['page'] === 'settings' || value['page'] === 'welcome')
  );
}

export function isCanvasDetectedMessage(value: unknown): value is CanvasDetectedMessage {
  return hasType(value, 'weekrow:canvas-detected') && isNonEmptyString(value['origin']);
}

export function isDataMessage(value: unknown): value is DataMessage {
  return (
    isGetStateMessage(value) ||
    isRefreshMessage(value) ||
    isActionMessage(value) ||
    isSetupMessage(value) ||
    isChangeAddressMessage(value) ||
    isCoursesMessage(value) ||
    isOpenPageMessage(value) ||
    isCanvasDetectedMessage(value)
  );
}

const STATE_KINDS: readonly string[] = [
  'loading',
  'not_set_up',
  'checking',
  'no_access',
  'redirects',
  'not_canvas',
  'unreachable',
  'signed_out',
  'no_courses',
  'cant_load',
  'ready',
];

/** A light check of a state reply. The background is the only sender, so the kind is enough. */
export function isSurfaceState(value: unknown): value is SurfaceState {
  return isObject(value) && isString(value['kind']) && STATE_KINDS.includes(value['kind']);
}

const UNDO_KINDS: readonly string[] = ['done', 'skipped', 'skipped_all', 'deleted'];

function isUndoTicket(value: unknown): value is UndoTicket {
  if (!isObject(value) || !isNonEmptyString(value['token'])) return false;
  const info = value['info'];
  return (
    isObject(info) &&
    isString(info['kind']) &&
    UNDO_KINDS.includes(info['kind']) &&
    Number.isInteger(info['count'])
  );
}

export function isActionReply(value: unknown): value is ActionReply {
  return isObject(value) && (value['undo'] === null || isUndoTicket(value['undo']));
}

export function isRefreshReply(value: unknown): value is RefreshReply {
  if (!isObject(value) || value['ok'] !== true) return false;
  const retryAt = value['retryAt'];
  return retryAt === null || (typeof retryAt === 'number' && Number.isFinite(retryAt));
}

export function isCanvasDetectedReply(value: unknown): value is CanvasDetectedReply {
  return isObject(value) && isStringOrNull(value['origin']);
}

export function isCoursesReply(value: unknown): value is CoursesReply {
  return (
    isObject(value) &&
    Array.isArray(value['courses']) &&
    value['courses'].every(
      (course: unknown) => isObject(course) && isString(course['id']) && isString(course['name']),
    )
  );
}
