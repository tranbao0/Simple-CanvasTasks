/**
 * The course home page adapter. See docs/design.md, decision 4, "In-page rules".
 *
 * It mounts only when the path is exactly `/courses/:id` and the body has `with-right-side`.
 * K-5 subject course home pages have no right column, so they never meet the condition.
 */
import { findSidebarAnchors } from './anchors';
import type { InpageAdapter } from './types';

/** `/courses/123`, with an optional trailing slash. Cross-shard ids look like `1~2`. */
const COURSE_HOME_PATH = /^\/courses\/(\d+(?:~\d+)?)\/?$/;

/** The course id of a course home path, or `null` for any other path. */
export function courseHomeId(pathname: string): string | null {
  return COURSE_HOME_PATH.exec(pathname)?.[1] ?? null;
}

export const courseHomeAdapter: InpageAdapter = {
  layout: 'course_home',
  match(pathname) {
    const courseId = courseHomeId(pathname);
    return courseId === null ? null : { courseId };
  },
  findAnchors: findSidebarAnchors,
};
