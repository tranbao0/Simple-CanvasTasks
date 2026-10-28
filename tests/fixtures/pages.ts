/**
 * The fake Canvas pages in `tests/fixtures/pages`, with the URL to serve each one at and what
 * the in-page adapter must do there (design decision 4).
 *
 * Canvas pages fill parts of themselves after load, as Canvas does. Wait for
 * `html[data-fixture-ready="true"]` before asserting or taking a screenshot, or open the page
 * with `?fixture_delay_ms=0` to shorten the pauses between steps.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_ORIGIN = 'https://school.instructure.com';
export const FIXTURE_READY_SELECTOR = 'html[data-fixture-ready="true"]';

/** Where the in-page list belongs on a page, or `none` when nothing may be injected. */
export type ExpectedMount = 'dashboard' | 'course_home' | 'none';

export interface FixturePage {
  /** File name in tests/fixtures/pages. */
  file: string;
  /** The URL to serve the file at. */
  url: string;
  expectedMount: ExpectedMount;
  /** The course of a course home page. */
  courseId: string | null;
  /** The page has the student To Do (`.Sidebar__TodoListContainer`) that the list hides after it renders. */
  hasStudentTodo: boolean;
  /** The page has the legacy teacher To Do, which stays visible under the list. */
  hasTeacherTodo: boolean;
}

export const FIXTURE_PAGES = {
  dashboardCardView: {
    file: 'dashboard-card-view.html',
    url: `${FIXTURE_ORIGIN}/`,
    expectedMount: 'dashboard',
    courseId: null,
    hasStudentTodo: true,
    hasTeacherTodo: false,
  },
  dashboardRecentActivity: {
    file: 'dashboard-recent-activity.html',
    url: `${FIXTURE_ORIGIN}/`,
    expectedMount: 'dashboard',
    courseId: null,
    hasStudentTodo: true,
    hasTeacherTodo: false,
  },
  dashboardListView: {
    file: 'dashboard-list-view.html',
    url: `${FIXTURE_ORIGIN}/`,
    expectedMount: 'none',
    courseId: null,
    hasStudentTodo: false,
    hasTeacherTodo: false,
  },
  dashboardWidgets: {
    file: 'dashboard-widgets.html',
    url: `${FIXTURE_ORIGIN}/`,
    expectedMount: 'none',
    courseId: null,
    hasStudentTodo: false,
    hasTeacherTodo: false,
  },
  dashboardMixedRole: {
    file: 'dashboard-mixed-role.html',
    url: `${FIXTURE_ORIGIN}/`,
    expectedMount: 'dashboard',
    courseId: null,
    hasStudentTodo: false,
    hasTeacherTodo: true,
  },
  courseHome: {
    file: 'course-home.html',
    url: `${FIXTURE_ORIGIN}/courses/101`,
    expectedMount: 'course_home',
    courseId: '101',
    hasStudentTodo: true,
    hasTeacherTodo: false,
  },
  /** The home page of the course the scenario student hides. The list shows a one-line note there. */
  courseHomeHiddenCourse: {
    file: 'course-home-hidden-course.html',
    url: `${FIXTURE_ORIGIN}/courses/106`,
    expectedMount: 'course_home',
    courseId: '106',
    hasStudentTodo: true,
    hasTeacherTodo: false,
  },
  courseHomeK5: {
    file: 'course-home-k5.html',
    url: `${FIXTURE_ORIGIN}/courses/107`,
    expectedMount: 'none',
    courseId: '107',
    hasStudentTodo: false,
    hasTeacherTodo: false,
  },
  notCanvas: {
    file: 'not-canvas.html',
    url: 'https://news.northfield.edu/',
    expectedMount: 'none',
    courseId: null,
    hasStudentTodo: false,
    hasTeacherTodo: false,
  },
} as const satisfies Record<string, FixturePage>;

export type FixturePageName = keyof typeof FIXTURE_PAGES;

/** The absolute path of a page file, for reading it in a route handler. */
export function fixturePagePath(page: Pick<FixturePage, 'file'>): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'pages', page.file);
}
