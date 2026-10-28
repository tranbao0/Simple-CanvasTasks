/**
 * Hides the native student To Do while the in-page list shows.
 * See docs/design.md, decision 4, "In-page rules".
 *
 * Only `.Sidebar__TodoListContainer` is hidden. Coming Up, Recent Feedback and the teacher
 * To Do (`.todo-list-header` and `.to-do-list`) stay visible. The style goes in only after the
 * first successful render and comes out again when the list ends in an error state.
 */
import type { SurfaceState } from '../model/types';

export const HIDE_NATIVE_TODO_STYLE_ID = 'weekrow-hide-native-todo';
export const HIDE_NATIVE_TODO_CSS =
  '#right-side .Sidebar__TodoListContainer { display: none !important; }';

/** Adds the scoped style that hides the student To Do. Safe to call more than once. */
export function hideNativeTodo(doc: Document = document): void {
  if (doc.getElementById(HIDE_NATIVE_TODO_STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = HIDE_NATIVE_TODO_STYLE_ID;
  style.textContent = HIDE_NATIVE_TODO_CSS;
  (doc.head ?? doc.documentElement).append(style);
}

/** Removes the style, so the student To Do shows again. */
export function showNativeTodo(doc: Document = document): void {
  doc.getElementById(HIDE_NATIVE_TODO_STYLE_ID)?.remove();
}

export function isNativeTodoHidden(doc: Document = document): boolean {
  return doc.getElementById(HIDE_NATIVE_TODO_STYLE_ID) !== null;
}

export type NativeTodoAction = 'hide' | 'show' | 'keep';

/**
 * What to do with the native To Do after the in-page list renders a state.
 * A list hides it; an error state shows it again; a pending state changes nothing.
 * On the home page of a course the student hid, the surface shows a note instead of the list,
 * so the native To Do shows.
 */
export function nativeTodoAction(state: SurfaceState): NativeTodoAction {
  switch (state.kind) {
    case 'ready':
      return state.view.scopeCourseHidden ? 'show' : 'hide';
    case 'no_courses':
      return 'hide';
    case 'loading':
    case 'checking':
      return 'keep';
    case 'not_set_up':
    case 'no_access':
    case 'redirects':
    case 'not_canvas':
    case 'unreachable':
    case 'signed_out':
    case 'cant_load':
      return 'show';
  }
}

/** Applies `nativeTodoAction` for the rendered state. */
export function syncNativeTodo(state: SurfaceState, doc: Document = document): void {
  const action = nativeTodoAction(state);
  switch (action) {
    case 'hide':
      hideNativeTodo(doc);
      return;
    case 'show':
      showNativeTodo(doc);
      return;
    case 'keep':
      return;
  }
}
