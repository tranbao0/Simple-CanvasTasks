/**
 * Canvas error responses with their exact status, headers and body text.
 *
 * Sources in canvas-lms at commit 1c9f0bb:
 * - `render_json_unauthorized` and `add_www_authenticate_header` (lib/authentication_methods.rb);
 * - `RequestThrottle#rate_limit_exceeded` (app/middleware/request_throttle.rb);
 * - `PlannerOverridesController#create` with the `plannable_id` uniqueness validation;
 * - `AssignmentsApiController#get_assignments` for the `assignment_ids[]` checks.
 */

export interface CanvasErrorFixture {
  status: number;
  headers: Readonly<Record<string, string>>;
  /** The raw body text. */
  body: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;
const THROTTLE_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'X-Rate-Limit-Remaining': '0.0',
} as const;

function jsonError(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = JSON_HEADERS,
): CanvasErrorFixture {
  return { status, headers, body: JSON.stringify(body) };
}

export const CANVAS_ERRORS = {
  /** Any API call with no session. Canvas adds the Bearer realm header, which marks the site as Canvas. */
  signedOut: jsonError(
    401,
    { status: 'unauthenticated', errors: [{ message: 'user authorization required' }] },
    { ...JSON_HEADERS, 'WWW-Authenticate': 'Bearer realm="canvas-lms"' },
  ),
  /**
   * A signed-in student under "Limited Access for Students": the planner and planner notes
   * answer 403 with JSON `status` `unauthorized`.
   */
  limitedAccess: jsonError(403, {
    status: 'unauthorized',
    errors: [{ message: 'user not authorized to perform that action' }],
  }),
  /** The throttle on self-hosted or older Canvas. */
  rateLimited403: {
    status: 403,
    headers: THROTTLE_HEADERS,
    body: '403 Forbidden (Rate Limit Exceeded)\n',
  },
  /** The throttle on Instructure-hosted Canvas. */
  rateLimited429: {
    status: 429,
    headers: THROTTLE_HEADERS,
    body: '429 Too Many Requests (Rate Limit Exceeded)\n',
  },
  /** A second `POST /api/v1/planner/overrides` for the same item. */
  overrideExists: jsonError(400, {
    errors: { plannable_id: [{ attribute: 'plannable_id', type: 'taken', message: 'taken' }] },
  }),
  notFound: jsonError(404, { errors: [{ message: 'The specified resource does not exist.' }] }),
  serverError: jsonError(500, {
    errors: [{ message: 'An error occurred.', error_code: 'internal_server_error' }],
    error_report_id: '6235',
  }),
  /** More than 100 `assignment_ids[]` in one request. Canvas puts two spaces before "Limit". */
  tooManyAssignmentIds: jsonError(400, {
    message: 'Request contains too many assignment_ids.  Limit 100',
  }),
} as const satisfies Record<string, CanvasErrorFixture>;

/**
 * Canvas rejects the whole assignments request when an id is not an assignment the student can
 * see, such as a `sub_assignment` id, or when `per_page` is smaller than the number of ids.
 */
export function invalidAssignmentIds(ids: readonly string[]): CanvasErrorFixture {
  return jsonError(400, { message: `Invalid assignment_ids: ${ids.join(',')}` });
}

/** Responses from a site that is not Canvas, for the setup check. */
export const NOT_CANVAS_RESPONSES = {
  /** A normal web page at `/api/v1/users/self`. */
  htmlPage: {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: '<!DOCTYPE html><html><head><title>Northfield State University</title></head><body><h1>Page not found</h1></body></html>',
  },
  /** A 401 from another app: no `Bearer realm="canvas-lms"` header. */
  otherApp401: jsonError(
    401,
    { error: 'unauthorized' },
    { ...JSON_HEADERS, 'WWW-Authenticate': 'Basic realm="intranet"' },
  ),
  /** A school address that sends the browser to its sign-in service. */
  redirectToSignIn: {
    status: 302,
    headers: {
      Location: 'https://sso.northfield.edu/idp/profile/SAML2/Redirect/SSO?execution=e1s1',
    },
    body: '',
  },
} as const satisfies Record<string, CanvasErrorFixture>;

/** Canvas puts this prefix before some JSON bodies. The client removes it. */
export const WHILE_ONE_PREFIX = 'while(1);';
