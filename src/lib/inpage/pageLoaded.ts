/**
 * Tells the background that a page of the saved Canvas loaded, so that it refreshes the
 * planner items. See docs/design.md, decision 11, "Refresh triggers".
 */
import { browser } from 'wxt/browser';
import type { CanvasPageLoadedMessage } from '../platform/messages';

/** Sends the page-loaded message. A missing or stopped background is not an error here. */
export async function announceCanvasPageLoaded(origin: string): Promise<void> {
  const message: CanvasPageLoadedMessage = { type: 'weekrow:canvas-page-loaded', origin };
  try {
    await browser.runtime.sendMessage(message);
  } catch {
    // The background may be updating. The next page load or a focus change refreshes instead.
  }
}
