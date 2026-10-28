import { test as base, chromium, expect, type BrowserContext, type Worker } from '@playwright/test';
import { targetDir } from '../../../scripts/lib/ensure-build.mjs';

/** The unpacked Chrome build that the tests load. tests/e2e/global-setup.ts keeps it fresh. */
export const CHROME_EXTENSION_DIR = targetDir('chrome');

/** How long to wait for the extension service worker after launch. */
const WORKER_TIMEOUT_MS = 10_000;

export interface ExtensionFixtures {
  /** A new persistent Chromium context, headless, with the built extension loaded. */
  context: BrowserContext;
  /** The background service worker of the extension. */
  serviceWorker: Worker;
  /** The extension id, which is the host of its chrome-extension:// URLs. */
  extensionId: string;
  /** Returns the chrome-extension:// URL of a built file, such as `sidepanel.html`. */
  extensionUrl: (file: string) => string;
}

function isExtensionWorker(worker: Worker): boolean {
  return worker.url().startsWith('chrome-extension://');
}

/**
 * The Playwright test function with the extension fixtures.
 * The built-in `page` fixture opens a tab in the extension context.
 */
export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${CHROME_EXTENSION_DIR}`,
        `--load-extension=${CHROME_EXTENSION_DIR}`,
      ],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers().find(isExtensionWorker) ??
      (await context
        .waitForEvent('serviceworker', { predicate: isExtensionWorker, timeout: WORKER_TIMEOUT_MS })
        .catch((error: unknown) => {
          throw new Error(
            `The extension service worker did not start. Chromium may have rejected ${CHROME_EXTENSION_DIR}; ` +
              'run "npm run check:manifest" to look for manifest problems.',
            { cause: error },
          );
        }));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  extensionUrl: async ({ extensionId }, use) => {
    await use((file) => `chrome-extension://${extensionId}/${file.replace(/^\//, '')}`);
  },
});

export { expect };
