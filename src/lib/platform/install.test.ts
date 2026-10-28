import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { shouldOpenWelcome, wireWelcomePage } from './install';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('shouldOpenWelcome', () => {
  it('opens the welcome page only on a fresh install on Chrome and Edge', () => {
    expect(shouldOpenWelcome('install', 'chrome')).toBe(true);
    expect(shouldOpenWelcome('install', 'edge')).toBe(true);
    expect(shouldOpenWelcome('install', 'firefox')).toBe(false);
    expect(shouldOpenWelcome('update', 'chrome')).toBe(false);
    expect(shouldOpenWelcome('chrome_update', 'chrome')).toBe(false);
  });
});

describe('wireWelcomePage', () => {
  it('opens the local welcome page on install', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    const remove = wireWelcomePage('chrome');

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.1.0' });
    expect(create).not.toHaveBeenCalled();

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    expect(create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/welcome.html',
    });

    remove();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('opens nothing on Firefox, where the sidebar opens at install', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    wireWelcomePage('firefox');

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    expect(create).not.toHaveBeenCalled();
  });
});
