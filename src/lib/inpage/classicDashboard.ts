/**
 * The classic dashboard adapter: Card View and Recent Activity.
 * See docs/design.md, decision 4, "In-page rules".
 *
 * It mounts only when the body has `with-right-side` and `#right-side` holds the student
 * To Do (`.Sidebar__TodoListContainer`), the teacher To Do header (`.todo-list-header`) or
 * Coming Up (`.coming_up`). Canvas loads that sidebar after the page, so the caller waits for it.
 * The widget dashboard and List View never meet this condition.
 */
import { findSidebarAnchors } from './anchors';
import type { InpageAdapter } from './types';

/** The dashboard is the root path. `/dashboard` serves the same page. */
const DASHBOARD_PATH = /^\/(?:dashboard\/?)?$/;
const SIDEBAR_CONTENT = '.Sidebar__TodoListContainer, .todo-list-header, .coming_up';

export const classicDashboardAdapter: InpageAdapter = {
  layout: 'dashboard',
  match(pathname) {
    return DASHBOARD_PATH.test(pathname) ? { courseId: null } : null;
  },
  findAnchors(doc) {
    const anchors = findSidebarAnchors(doc);
    if (anchors === null || anchors.rightSide.querySelector(SIDEBAR_CONTENT) === null) return null;
    return anchors;
  },
};
