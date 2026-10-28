import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { PANEL_PORT_NAME } from './messages';
import { createPanelRegistry, notifyCanvasTabs, type PanelRegistry } from './panelRegistry';
import { canvasOriginItem } from './storage';
import {
  closeRemote,
  fakeEvent,
  fakePort,
  matchesPattern,
  panelSender,
  receive,
  type FakeEvent,
  type FakePort,
} from './testing/fakes';

const ORIGIN = 'https://canvas.school.edu';

interface TabFixture {
  id: number;
  windowId: number;
  url: string;
}

const TABS: TabFixture[] = [
  { id: 11, windowId: 1, url: `${ORIGIN}/` },
  { id: 12, windowId: 1, url: `${ORIGIN}/courses/5` },
  { id: 13, windowId: 1, url: 'https://news.example.com/' },
  { id: 21, windowId: 2, url: `${ORIGIN}/` },
];

let onConnect: FakeEvent<[FakePort]>;
let onAttached: FakeEvent<[number, Browser.tabs.OnAttachedInfo]>;
let sendMessage: ReturnType<typeof vi.fn>;
let query: ReturnType<typeof vi.fn>;
let registry: PanelRegistry;

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Simulates a panel page that connects and says hello for its window. */
function connectPanel(windowId: number): FakePort {
  const port = fakePort(PANEL_PORT_NAME, panelSender());
  onConnect.trigger(port);
  receive(port, { type: 'weekrow:panel-hello', windowId });
  return port;
}

function sentTo(): [number, unknown][] {
  return sendMessage.mock.calls.map(([tabId, message]) => [tabId as number, message]);
}

beforeEach(async () => {
  fakeBrowser.reset();
  onConnect = fakeEvent();
  onAttached = fakeEvent();
  sendMessage = vi.fn(async () => undefined);
  query = vi.fn(async (info: { windowId?: number; url?: string }) =>
    TABS.filter(
      (tab) =>
        (info.windowId === undefined || tab.windowId === info.windowId) &&
        (info.url === undefined || matchesPattern(info.url, tab.url)),
    ),
  );
  Object.assign(fakeBrowser.runtime, { onConnect });
  Object.assign(fakeBrowser.tabs, { onAttached, sendMessage, query });
  await canvasOriginItem.setValue(ORIGIN);
  registry = createPanelRegistry();
});

afterEach(() => {
  registry.dispose();
});

describe('panel registry', () => {
  it('records a panel after its hello and tells the Canvas tabs of that window', async () => {
    connectPanel(1);
    await settle();

    expect(registry.isOpen(1)).toBe(true);
    expect(registry.isOpen(2)).toBe(false);
    expect(registry.openWindowIds()).toEqual([1]);
    expect(query).toHaveBeenCalledWith({ windowId: 1, url: `${ORIGIN}/*` });
    expect(sentTo()).toEqual([
      [11, { type: 'weekrow:panel-open', open: true }],
      [12, { type: 'weekrow:panel-open', open: true }],
    ]);
  });

  it('keeps the panel open on heartbeats and sends nothing more', async () => {
    const port = connectPanel(1);
    await settle();
    sendMessage.mockClear();

    receive(port, { type: 'weekrow:panel-heartbeat' });
    receive(port, { type: 'weekrow:panel-heartbeat' });
    receive(port, { type: 'weekrow:panel-hello', windowId: 2 });
    await settle();

    expect(registry.openWindowIds()).toEqual([1]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('waits for the hello before it counts a port', () => {
    const port = fakePort(PANEL_PORT_NAME, panelSender());
    onConnect.trigger(port);
    receive(port, { type: 'weekrow:panel-heartbeat' });

    expect(registry.isOpen(1)).toBe(false);
    receive(port, { type: 'weekrow:panel-hello', windowId: 1 });
    expect(registry.isOpen(1)).toBe(true);
  });

  it('marks the window closed on disconnect and tells its Canvas tabs', async () => {
    const port = connectPanel(1);
    await settle();
    sendMessage.mockClear();

    closeRemote(port);
    await settle();

    expect(registry.isOpen(1)).toBe(false);
    expect(sentTo()).toEqual([
      [11, { type: 'weekrow:panel-open', open: false }],
      [12, { type: 'weekrow:panel-open', open: false }],
    ]);
  });

  it('stays open when a reconnecting panel overlaps its old port', async () => {
    const oldPort = connectPanel(1);
    connectPanel(1);
    closeRemote(oldPort);
    await settle();

    expect(registry.isOpen(1)).toBe(true);
    expect(sentTo().map(([, message]) => message)).toEqual([
      { type: 'weekrow:panel-open', open: true },
      { type: 'weekrow:panel-open', open: true },
    ]);
  });

  it('rebuilds its record when panels reconnect after a service worker restart', async () => {
    connectPanel(1);
    connectPanel(2);
    registry.dispose();
    registry = createPanelRegistry();
    expect(registry.openWindowIds()).toEqual([]);

    connectPanel(1);
    connectPanel(2);
    await settle();

    expect(registry.openWindowIds().sort()).toEqual([1, 2]);
  });

  it('tracks windows separately', async () => {
    const first = connectPanel(1);
    connectPanel(2);
    closeRemote(first);
    await settle();

    expect(registry.isOpen(1)).toBe(false);
    expect(registry.isOpen(2)).toBe(true);
  });

  it('ignores ports with another name and ports from content scripts', () => {
    onConnect.trigger(fakePort('other', panelSender()));
    const fromPage = fakePort(PANEL_PORT_NAME, {
      id: fakeBrowser.runtime.id,
      url: `${ORIGIN}/`,
      tab: { id: 11 } as Browser.tabs.Tab,
    });
    onConnect.trigger(fromPage);
    receive(fromPage, { type: 'weekrow:panel-hello', windowId: 1 });

    expect(registry.isOpen(1)).toBe(false);
  });

  it('reports changes to listeners until they are removed', () => {
    const listener = vi.fn();
    const remove = registry.onChange(listener);
    const port = connectPanel(3);
    closeRemote(port);
    remove();
    connectPanel(3);

    expect(listener.mock.calls).toEqual([
      [3, true],
      [3, false],
    ]);
  });

  it('answers a content script that asks for its window state', () => {
    connectPanel(1);
    const replies: unknown[] = [];
    const reply = (value: unknown): void => {
      replies.push(value);
    };

    fakeBrowser.runtime.onMessage.trigger(
      { type: 'weekrow:panel-state' },
      { tab: { windowId: 1 } as Browser.tabs.Tab },
      reply,
    );
    fakeBrowser.runtime.onMessage.trigger(
      { type: 'weekrow:panel-state' },
      { tab: { windowId: 2 } as Browser.tabs.Tab },
      reply,
    );
    fakeBrowser.runtime.onMessage.trigger({ type: 'weekrow:panel-state' }, {}, reply);
    fakeBrowser.runtime.onMessage.trigger(
      { type: 'other' },
      { tab: { windowId: 1 } as Browser.tabs.Tab },
      reply,
    );

    expect(replies).toEqual([{ open: true }, { open: false }, { open: false }]);
  });

  it('gives a tab moved to another window the state of that window', async () => {
    connectPanel(2);
    await settle();
    sendMessage.mockClear();

    onAttached.trigger(11, { newWindowId: 2, newPosition: 0 });
    onAttached.trigger(12, { newWindowId: 5, newPosition: 0 });
    await settle();

    expect(sentTo()).toEqual([
      [11, { type: 'weekrow:panel-open', open: true }],
      [12, { type: 'weekrow:panel-open', open: false }],
    ]);
  });

  it('removes its browser listeners on dispose', () => {
    registry.dispose();

    expect(onConnect.hasListeners()).toBe(false);
    expect(onAttached.hasListeners()).toBe(false);
    expect(fakeBrowser.runtime.onMessage.hasListeners()).toBe(false);
  });
});

describe('notifyCanvasTabs', () => {
  it('does nothing without a saved address', async () => {
    await canvasOriginItem.setValue(null);
    await notifyCanvasTabs(1, true);

    expect(query).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reaches every tab even when one has no content script', async () => {
    sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    await notifyCanvasTabs(1, false);

    expect(sentTo().map(([tabId]) => tabId)).toEqual([11, 12]);
  });
});
