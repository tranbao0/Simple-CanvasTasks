/**
 * How a failed Canvas request maps to a state. See docs/design.md, decision 11,
 * "States the UI must show".
 */
import { CanvasError, type CanvasApi, type CanvasErrorKind } from '../canvas/types';
import type { Failure, FailureSource } from './cache';

export function isCanvasError(error: unknown, kind?: CanvasErrorKind): error is CanvasError {
  return error instanceof CanvasError && (kind === undefined || error.kind === kind);
}

/**
 * Errors that belong to one course: a course that is gone (404), a request Canvas rejects for
 * that course (400, 403), a server error (5xx) or an answer that is not Canvas JSON. The round
 * skips the course and keeps the rest of the list. Network errors, rate limits and 401s are
 * not course errors: they fail the round.
 */
export function isCourseScoped(error: unknown): boolean {
  return (
    isCanvasError(error) &&
    (error.kind === 'not_found' ||
      error.kind === 'forbidden' ||
      error.kind === 'bad_request' ||
      error.kind === 'server' ||
      error.kind === 'not_canvas')
  );
}

/** A course error that hints at a Canvas outage rather than a problem with one course. */
export function isOutageError(error: unknown): boolean {
  return isCanvasError(error) && (error.kind === 'server' || error.kind === 'not_canvas');
}

/**
 * The causes of the "Can't refresh" state in decision 11: HTTP 429, a 403 with
 * "Rate Limit Exceeded", HTTP 5xx and network errors.
 */
export function isRefreshFailure(failure: Failure): boolean {
  if (failure.kind !== 'stale') return false;
  return failure.cause === 'rate_limited' || failure.cause === 'server' || failure.offline;
}

/** The "Can't refresh" failure. The cause stays for logs and the retry logic. */
export function staleFailure(error: unknown, at: number, source: FailureSource = 'round'): Failure {
  if (!isCanvasError(error)) return { kind: 'stale', offline: false, cause: 'unknown', at, source };
  return { kind: 'stale', offline: error.kind === 'network', cause: error.kind, at, source };
}

/**
 * The failure for an error. Any 401 runs the sign-in check: when `GET /api/v1/users/self`
 * also returns 401, the student is signed out. Otherwise the list goes stale.
 */
export async function failureFor(
  error: unknown,
  api: CanvasApi,
  at: number,
  source: FailureSource = 'round',
): Promise<Failure> {
  if (!isCanvasError(error, 'unauthorized')) return staleFailure(error, at, source);
  try {
    await api.getSelf();
    return staleFailure(error, at, source);
  } catch (checkError) {
    if (isCanvasError(checkError, 'unauthorized')) return { kind: 'signed_out' };
    return staleFailure(checkError, at, source);
  }
}
