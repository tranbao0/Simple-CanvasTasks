/**
 * Background side of panel presence. See docs/design.md, decision 4, "Opening and closing the panel".
 *
 * Each open panel holds a `runtime.connect` port named `weekrow-panel`. Its first message
 * carries the window id, and the port closes with the panel. The registry keeps the open
 * ports per window and tells the Canvas tabs of a window when its panel opens or closes, so
 * the in-page list there can collapse to one line.
 *
 * After a service worker restart the registry starts empty. The panels connect again at once,
 * and the registry rebuilds itself from those connections.
 */
import { browser, type Browser } from 'wxt/browser';
import { originMatchPattern } from './address';
import { logFailure } from './log';
import {
  PANEL_PORT_NAME,
  isPanelHelloMessage,
  isPanelStateQuery,
  type PanelOpenMessage,
  type PanelStateReply,
} from './messages';
import { canvasOriginItem } from './storage';

type Port = Browser.runtime.Port;
type MessageSender = Browser.runtime.MessageSender;

export type PanelChangeListener = (windowId: number, open: boolean) => void;

export interface PanelRegistry {
  /** Whether a panel is open in the window. Synchronous, so a click handler can use it. */
  isOpen(windowId: number): boolean;
  openWindowIds(): number[];
  /** Calls the listener when a window's panel opens or closes. Returns a remover. */
  onChange(listener: PanelChangeListener): () => void;
  /** Removes the browser listeners and forgets every port. */
  dispose(): void;
}

export interface PanelRegistryOptions {
  /** Tells the tabs of a window about a change. Defaults to `notifyCanvasTabs`. */
  notifyTabs?: (windowId: number, open: boolean) => Promise<void>;
}

function panelOpenMessage(open: boolean): PanelOpenMessage {
  return { type: 'weekrow:panel-open', open };
}

/** Sends a message to a tab and ignores a tab that has no content script listening. */
async function sendToTab(tabId: number | undefined, message: PanelOpenMessage): Promise<void> {
  if (tabId === undefined) return;
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch {
    // The tab has no Weekrow content script, for example a Canvas page that is still loading.
  }
}

/** Sends the panel state to every tab of the window that shows the saved Canvas. */
export async function notifyCanvasTabs(windowId: number, open: boolean): Promise<void> {
  const origin = await canvasOriginItem.getValue();
  if (origin === null) return;
  const pattern = originMatchPattern(origin);
  if (pattern === null) return;
  const tabs = await browser.tabs.query({ windowId, url: pattern });
  const message = panelOpenMessage(open);
  await Promise.all(tabs.map((tab) => sendToTab(tab.id, message)));
}

/** Only extension pages hold panel ports. Content scripts report the web page URL instead. */
function isExtensionPage(sender: MessageSender | undefined): boolean {
  return sender?.url?.startsWith(browser.runtime.getURL('/')) === true;
}

/**
 * Starts tracking panels. Call it once, synchronously, at the top level of the background,
 * so that its listeners exist before any panel connects.
 */
export function createPanelRegistry(options: PanelRegistryOptions = {}): PanelRegistry {
  const notifyTabs = options.notifyTabs ?? notifyCanvasTabs;
  const portsByWindow = new Map<number, Set<Port>>();
  const listeners = new Set<PanelChangeListener>();

  const isOpen = (windowId: number): boolean => (portsByWindow.get(windowId)?.size ?? 0) > 0;

  const announce = (windowId: number, open: boolean): void => {
    for (const listener of listeners) listener(windowId, open);
    notifyTabs(windowId, open).catch((error: unknown) => logFailure('panel tab notice', error));
  };

  const addPort = (windowId: number, port: Port): void => {
    const wasOpen = isOpen(windowId);
    const ports = portsByWindow.get(windowId) ?? new Set<Port>();
    ports.add(port);
    portsByWindow.set(windowId, ports);
    if (!wasOpen) announce(windowId, true);
  };

  const removePort = (windowId: number, port: Port): void => {
    const ports = portsByWindow.get(windowId);
    if (ports === undefined || !ports.delete(port) || ports.size > 0) return;
    portsByWindow.delete(windowId);
    announce(windowId, false);
  };

  const trackPort = (port: Port): void => {
    if (port.name !== PANEL_PORT_NAME || !isExtensionPage(port.sender)) return;
    let windowId: number | null = null;
    // Heartbeats need no answer: receiving them keeps the service worker running.
    const onMessage = (message: unknown): void => {
      if (windowId !== null || !isPanelHelloMessage(message)) return;
      windowId = message.windowId;
      addPort(windowId, port);
    };
    const onDisconnect = (): void => {
      void browser.runtime.lastError;
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      if (windowId !== null) removePort(windowId, port);
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
  };

  const answerStateQuery = (
    message: unknown,
    sender: MessageSender,
    sendResponse: (reply: PanelStateReply) => void,
  ): undefined => {
    if (!isPanelStateQuery(message)) return undefined;
    const windowId = sender.tab?.windowId;
    sendResponse({ open: windowId !== undefined && isOpen(windowId) });
    return undefined;
  };

  /** A tab dragged to another window takes that window's panel state. */
  const onAttached = (tabId: number, info: Browser.tabs.OnAttachedInfo): void => {
    void sendToTab(tabId, panelOpenMessage(isOpen(info.newWindowId)));
  };

  browser.runtime.onConnect.addListener(trackPort);
  browser.runtime.onMessage.addListener(answerStateQuery);
  browser.tabs.onAttached.addListener(onAttached);

  return {
    isOpen,
    openWindowIds: () => [...portsByWindow.keys()],
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      browser.runtime.onConnect.removeListener(trackPort);
      browser.runtime.onMessage.removeListener(answerStateQuery);
      browser.tabs.onAttached.removeListener(onAttached);
      portsByWindow.clear();
      listeners.clear();
    },
  };
}
