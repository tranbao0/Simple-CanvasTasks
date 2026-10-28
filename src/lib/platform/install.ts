/**
 * First run. See docs/design.md, decision 5, "First run".
 *
 * On Chrome and Edge, the local welcome page opens on install, because the panel cannot open
 * by itself. On Firefox, the sidebar opens at install through `open_at_install`.
 */
import { browser, type Browser } from 'wxt/browser';
import { BROWSER_KIND, type BrowserKind } from './browserKind';
import { logFailure } from './log';

/** Whether an `onInstalled` event should open the welcome page. */
export function shouldOpenWelcome(reason: string, kind: BrowserKind): boolean {
  return reason === 'install' && kind !== 'firefox';
}

/**
 * Opens the welcome page on a fresh install on Chrome and Edge. Call it once, synchronously,
 * at the top level of the background. Returns a function that removes the listener.
 */
export function wireWelcomePage(kind: BrowserKind = BROWSER_KIND): () => void {
  const listener = (details: Browser.runtime.InstalledDetails): void => {
    if (!shouldOpenWelcome(details.reason, kind)) return;
    browser.tabs
      .create({ url: browser.runtime.getURL('/welcome.html') })
      .catch((error: unknown) => logFailure('welcome page', error));
  };
  browser.runtime.onInstalled.addListener(listener);
  return () => browser.runtime.onInstalled.removeListener(listener);
}
