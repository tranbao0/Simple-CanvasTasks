/**
 * Content script side of panel presence. See docs/design.md, decision 4, "In-page rules".
 *
 * While the side panel is open in a window, the in-page list in that window collapses to one
 * line. The background sends `weekrow:panel-open` messages when the panel opens or closes, and
 * answers a `weekrow:panel-state` query for the state at page load.
 */
import { browser } from 'wxt/browser';
import { isPanelOpenMessage, isPanelStateReply, type PanelStateQuery } from '../platform/messages';

/**
 * Calls `onChange` with the current panel state of this tab's window, and again on every change.
 * Returns a function that stops listening.
 */
export function watchPanelOpen(onChange: (open: boolean) => void): () => void {
  let active = true;
  let pushed = false;

  const listener = (message: unknown): undefined => {
    if (!active || !isPanelOpenMessage(message)) return undefined;
    pushed = true;
    onChange(message.open);
    return undefined;
  };
  browser.runtime.onMessage.addListener(listener);

  const query: PanelStateQuery = { type: 'weekrow:panel-state' };
  browser.runtime
    .sendMessage(query)
    .then((reply: unknown) => {
      // A pushed change is newer than the reply, so the reply then has nothing to add.
      if (active && !pushed && isPanelStateReply(reply)) onChange(reply.open);
    })
    .catch(() => {
      // No background answer: the list stays expanded until a change arrives.
    });

  return () => {
    active = false;
    browser.runtime.onMessage.removeListener(listener);
  };
}
