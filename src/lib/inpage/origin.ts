/**
 * Which Canvas the content script serves. See docs/design.md, decision 5.
 *
 * The content script mounts only when the page origin equals the saved address. It never saves
 * the address itself: on an `instructure.com` Canvas page with no saved address, it reports the
 * detected Canvas to the background, which saves the page origin when the rules allow it.
 */
import { browser } from 'wxt/browser';
import { isCanvasDetectedReply, type CanvasDetectedMessage } from '../data/protocol';
import { isInstructureHost, isTestOrBetaHost, normalizeAddress } from '../platform/address';
import { isCanvasDocument } from '../platform/detectCanvas';
import { canvasOriginItem } from '../platform/storage';

/** Whether the page belongs to the saved Canvas. */
export function isSavedCanvasOrigin(pageOrigin: string, savedOrigin: string | null): boolean {
  return savedOrigin !== null && pageOrigin === savedOrigin;
}

/** Whether a Canvas page on this origin may become the saved address without asking. */
export function canAutoSaveOrigin(pageOrigin: string, savedOrigin: string | null): boolean {
  return (
    savedOrigin === null &&
    normalizeAddress(pageOrigin) === pageOrigin &&
    isInstructureHost(pageOrigin) &&
    !isTestOrBetaHost(pageOrigin)
  );
}

/** Reports a detected Canvas page and resolves with the saved address the background answers. */
async function reportCanvas(pageOrigin: string): Promise<string | null> {
  const message: CanvasDetectedMessage = { type: 'weekrow:canvas-detected', origin: pageOrigin };
  try {
    const reply: unknown = await browser.runtime.sendMessage(message);
    if (isCanvasDetectedReply(reply)) return reply.origin;
  } catch {
    // The background may be updating. The next page load reports the page again.
  }
  return canvasOriginItem.getValue();
}

/**
 * The saved Canvas origin. On the first visit to an `instructure.com` Canvas page with no
 * saved address, the background saves the page origin first, and the result is that origin.
 */
export async function resolveSavedOrigin(
  pageOrigin: string,
  doc: Document = document,
): Promise<string | null> {
  const saved = await canvasOriginItem.getValue();
  if (!canAutoSaveOrigin(pageOrigin, saved) || !isCanvasDocument(doc)) return saved;
  return reportCanvas(pageOrigin);
}
