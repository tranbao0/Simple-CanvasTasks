/**
 * Host access for the saved Canvas origin. See docs/design.md, decision 5.
 */
import { browser, type Browser } from 'wxt/browser';
import { originMatchPattern } from './address';

/** Whether the extension may reach the origin now. A withheld or removed grant gives `false`. */
export async function hasAccess(origin: string): Promise<boolean> {
  const pattern = originMatchPattern(origin);
  if (pattern === null) return false;
  return browser.permissions.contains({ origins: [pattern] });
}

/**
 * Asks the browser for access to the origin and resolves to whether it was granted.
 *
 * Both browsers accept the request only during a user gesture. Call this function directly
 * inside a click handler, with no `await` or other asynchronous step before the call.
 * It calls `permissions.request` synchronously and returns that promise.
 */
export function requestAccess(origin: string): Promise<boolean> {
  const pattern = originMatchPattern(origin);
  if (pattern === null) return Promise.resolve(false);
  return browser.permissions.request({ origins: [pattern] });
}

export type AccessChangeKind = 'added' | 'removed';

export interface AccessChange {
  kind: AccessChangeKind;
  /** Host match patterns in the change. Empty when only API permissions changed. */
  origins: string[];
}

/**
 * Calls the listener when permissions are added or removed, for example when the student
 * grants or withholds site access in the browser's own menus.
 * Returns a function that removes the listener.
 */
export function onAccessChanged(listener: (change: AccessChange) => void): () => void {
  const added = (permissions: Browser.permissions.Permissions): void =>
    listener({ kind: 'added', origins: permissions.origins ?? [] });
  const removed = (permissions: Browser.permissions.Permissions): void =>
    listener({ kind: 'removed', origins: permissions.origins ?? [] });
  browser.permissions.onAdded.addListener(added);
  browser.permissions.onRemoved.addListener(removed);
  return () => {
    browser.permissions.onAdded.removeListener(added);
    browser.permissions.onRemoved.removeListener(removed);
  };
}
