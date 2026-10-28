/**
 * The classic Canvas right column. See docs/design.md, decision 4, "In-page rules".
 *
 * Every Canvas page has `#right-side-wrapper`, but Canvas shows it only when the body has
 * the `with-right-side` class. Canvas replaces the contents of `#right-side`, so the list
 * mounts as a sibling before `#right-side`, inside `#right-side-wrapper`.
 */

export const MOUNT_CONTAINER_ID = 'weekrow-inpage';

export interface SidebarAnchors {
  wrapper: HTMLElement;
  rightSide: HTMLElement;
}

/** The right column anchors, or `null` when Canvas does not show a right column. */
export function findSidebarAnchors(doc: Document): SidebarAnchors | null {
  if (doc.body?.classList.contains('with-right-side') !== true) return null;
  const wrapper = doc.getElementById('right-side-wrapper');
  const rightSide = doc.getElementById('right-side');
  if (wrapper === null || rightSide === null || rightSide.parentElement !== wrapper) return null;
  return { wrapper, rightSide };
}

/** Creates the empty mount container before `#right-side`. */
export function createMountContainer(doc: Document, anchors: SidebarAnchors): HTMLElement {
  const container = doc.createElement('div');
  container.id = MOUNT_CONTAINER_ID;
  anchors.wrapper.insertBefore(container, anchors.rightSide);
  return container;
}
