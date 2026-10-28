/**
 * Shared types of the in-page adapters. See docs/design.md, decision 4.
 */
import type { SidebarAnchors } from './anchors';

export type InpageLayout = 'dashboard' | 'course_home';

export interface AdapterMatch {
  /** The course of a course home page, otherwise `null`. */
  courseId: string | null;
}

/** One page layout. An adapter that finds no anchor does nothing. */
export interface InpageAdapter {
  readonly layout: InpageLayout;
  /** Whether the adapter applies to the page path. */
  match(pathname: string): AdapterMatch | null;
  /** The anchors when the page meets the mount condition, otherwise `null`. */
  findAnchors(doc: Document): SidebarAnchors | null;
}

/** What the mount callback gets. */
export interface InpageMount {
  layout: InpageLayout;
  /** Set on a course home page: the list shows only this course. */
  courseId: string | null;
  /** The empty container, a sibling before `#right-side` inside `#right-side-wrapper`. */
  container: HTMLElement;
}

export type MountCallback = (mount: InpageMount) => void;
