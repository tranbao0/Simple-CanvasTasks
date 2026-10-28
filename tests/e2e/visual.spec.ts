import type { Page } from '@playwright/test';
import { FIXTURE_READY_SELECTOR } from '../fixtures/pages';
import { buildScenario } from '../fixtures/scenario';
import { test } from './support/extension';
import { serveFakeCanvas } from './support/fake-canvas';
import { apiRoutes, saveAddress } from './support/scenario-api';

/**
 * Screenshots of the real extension against the fake Canvas, for a person to review.
 * Runs only with WEEKROW_VISUAL=1. Images go to test-results/visual/.
 */
test.skip(!process.env['WEEKROW_VISUAL'], 'Set WEEKROW_VISUAL=1 to take review screenshots.');

const OUT = 'test-results/visual';

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [360, 240]) {
    test(`panel ${width}px ${scheme}`, async ({ context, page, serviceWorker, extensionUrl }) => {
      const scenario = buildScenario(new Date().toISOString());
      const canvas = await serveFakeCanvas(context, apiRoutes(scenario));
      await saveAddress(serviceWorker, canvas.origin);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 1400 });
      await page.goto(extensionUrl('sidepanel.html'));
      await settle(page);
      await page.screenshot({ path: `${OUT}/panel-${width}-${scheme}.png`, fullPage: true });
    });
  }
}

const PAGES: Record<string, string> = {
  '': 'dashboard-card-view',
  'courses/101': 'course-home',
};

for (const fixture of Object.keys(PAGES)) {
  test(`in-page ${fixture || 'dashboard'}`, async ({ context, page, serviceWorker }) => {
    const scenario = buildScenario(new Date().toISOString());
    const canvas = await serveFakeCanvas(context, [
      { path: `/${fixture}`, page: PAGES[fixture] ?? '' },
      ...apiRoutes(scenario),
    ]);
    await saveAddress(serviceWorker, canvas.origin);
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto(`${canvas.origin}/${fixture}?fixture_delay_ms=0`);
    await page.locator(FIXTURE_READY_SELECTOR).waitFor({ state: 'attached' });
    await settle(page);
    await page.waitForTimeout(800);
    const name = fixture ? fixture.replace('/', '-') : 'dashboard';
    await page.screenshot({ path: `${OUT}/inpage-${name}.png`, fullPage: true });
  });
}

for (const pageName of ['welcome.html', 'options.html']) {
  test(`page ${pageName}`, async ({ context, page, serviceWorker, extensionUrl }) => {
    const scenario = buildScenario(new Date().toISOString());
    const canvas = await serveFakeCanvas(context, apiRoutes(scenario));
    if (pageName === 'options.html') await saveAddress(serviceWorker, canvas.origin);
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.goto(extensionUrl(pageName));
    await settle(page);
    await page.screenshot({ path: `${OUT}/${pageName.replace('.html', '')}.png`, fullPage: true });
  });
}
