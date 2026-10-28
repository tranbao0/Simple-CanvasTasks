import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { toBrowserKind } from './browserKind';
import { canClosePanel, closePanel, openPanel } from './panel';
import {
  installFakeSidePanel,
  installFakeSidebarAction,
  removeFakeSidebarAction,
} from './testing/fakes';

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  removeFakeSidebarAction();
});

describe('toBrowserKind', () => {
  it('maps WXT browser names', () => {
    expect(toBrowserKind('chrome')).toBe('chrome');
    expect(toBrowserKind('edge')).toBe('edge');
    expect(toBrowserKind('firefox')).toBe('firefox');
    expect(toBrowserKind('opera')).toBe('chrome');
  });
});

describe.each(['chrome', 'edge'] as const)('on %s', (kind) => {
  it('opens the side panel of the window synchronously', async () => {
    const sidePanel = installFakeSidePanel();
    const pending = openPanel(4, kind);

    expect(sidePanel.open).toHaveBeenCalledWith({ windowId: 4 });
    await pending;
  });

  it('closes the side panel of the window synchronously', async () => {
    const sidePanel = installFakeSidePanel();
    const pending = closePanel(4, kind);

    expect(sidePanel.close).toHaveBeenCalledWith({ windowId: 4 });
    await pending;
  });

  it('detects whether sidePanel.close exists', () => {
    installFakeSidePanel();
    expect(canClosePanel(kind)).toBe(true);

    installFakeSidePanel({ withClose: false });
    expect(canClosePanel(kind)).toBe(false);
    return expect(closePanel(4, kind)).rejects.toThrow('sidePanel.close is not available');
  });

  it('passes on a rejected open, for example without a user gesture', async () => {
    const sidePanel = installFakeSidePanel();
    sidePanel.open.mockRejectedValueOnce(
      new Error('may only be called in response to a user gesture'),
    );

    await expect(openPanel(4, kind)).rejects.toThrow('user gesture');
  });
});

describe('on firefox', () => {
  it('opens and closes the sidebar synchronously', async () => {
    const sidebar = installFakeSidebarAction();

    const opening = openPanel(4, 'firefox');
    expect(sidebar.open).toHaveBeenCalledTimes(1);
    await opening;

    const closing = closePanel(4, 'firefox');
    expect(sidebar.close).toHaveBeenCalledTimes(1);
    await closing;
  });

  it('can close the sidebar when the API exists', () => {
    expect(canClosePanel('firefox')).toBe(false);
    installFakeSidebarAction();
    expect(canClosePanel('firefox')).toBe(true);
  });

  it('rejects when the sidebar API is missing', async () => {
    await expect(openPanel(4, 'firefox')).rejects.toThrow('sidebarAction.open is not available');
    await expect(closePanel(4, 'firefox')).rejects.toThrow('sidebarAction.close is not available');
  });
});
