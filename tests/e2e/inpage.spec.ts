/**
 * The in-page list on Canvas pages (design decision 4, "In-page rules"): the collapsed line while
 * the side panel is open, course home pages, the mixed-role dashboard, pages that get nothing,
 * and the compact list.
 */
import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/lib/model/types';
import { IDS, type Scenario } from '../fixtures/scenario';
import { readPageFixture } from './support/fake-canvas';
import { saveAddress, savedAddress } from './support/scenario-api';
import {
  doneBox,
  expect,
  group,
  inpageList,
  mainRows,
  openCanvasPage,
  saveSettings,
  serveScenario,
  test,
} from './support/weekrow';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const SHOWN_IN_PANEL = 'Shown in the side panel';

/**
 * Resolves when the Weekrow content script has started in the page, so a test can tell
 * "it ran and added nothing" from "it never ran". Call it before the page navigates.
 */
async function watchContentScript(page: Page): Promise<() => boolean> {
  const cdp = await page.context().newCDPSession(page);
  let started = false;
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    if (context.name === 'Weekrow for Canvas' && context.origin.startsWith('chrome-extension://')) {
      started = true;
    }
  });
  await cdp.send('Runtime.enable');
  return () => started;
}

interface TabsApi {
  tabs: {
    query(info: { url: string }): Promise<{ windowId: number }[]>;
    create(props: { url: string; windowId?: number }): Promise<unknown>;
  };
  windows: { create(props: { url: string }): Promise<unknown> };
}

/** The window of the first tab whose URL matches the pattern. */
async function windowOfTab(worker: Worker, pattern: string): Promise<number> {
  const windowId = await worker.evaluate(async (match) => {
    const chrome = (globalThis as unknown as { chrome: TabsApi }).chrome;
    const tabs = await chrome.tabs.query({ url: match });
    return tabs[0]?.windowId ?? null;
  }, pattern);
  if (windowId === null) throw new Error(`No tab matches ${pattern}`);
  return windowId;
}

/**
 * Opens the panel page as a tab of a given window, or in a new window, through the extension's
 * own tabs API. `context.newPage()` opens a tab in the last focused window, which a test with
 * two windows cannot control.
 */
async function openPanelTab(
  context: BrowserContext,
  worker: Worker,
  url: string,
  where: { windowId: number } | { newWindow: true },
): Promise<Page> {
  const opened = context.waitForEvent('page', (candidate) => candidate.url() === url);
  await worker.evaluate(
    async ([target, place]) => {
      const chrome = (globalThis as unknown as { chrome: TabsApi }).chrome;
      if ('windowId' in place) await chrome.tabs.create({ url: target, windowId: place.windowId });
      else await chrome.windows.create({ url: target });
    },
    [url, where] as const,
  );
  const page = await opened;
  await page.bringToFront();
  return page;
}

/** The titles of every item of one course, from the planner rows and the assignment list. */
function courseTitles(scenario: Scenario, courseId: string): Set<string> {
  const titles = new Set<string>();
  for (const row of scenario.plannerItems) {
    if (row.course_id === courseId || row.plannable.course_id === courseId) {
      titles.add(row.plannable.title);
    }
  }
  for (const assignment of scenario.assignments[courseId] ?? []) titles.add(assignment.name);
  return titles;
}

/** Opens every "Show N more" line and every collapsed group and line of the list. */
async function expandEverything(list: Locator): Promise<void> {
  for (;;) {
    const more = list.getByRole('button', { name: /^Show \d+ more$/ });
    if ((await more.count()) > 0) {
      await more.first().click();
      continue;
    }
    const closed = list.locator('button[aria-expanded="false"]:not([title])');
    if ((await closed.count()) > 0) {
      await closed.first().click();
      continue;
    }
    return;
  }
}

test.describe('side panel presence', () => {
  test('collapses to one line while the panel page is open in the same window, and comes back when it closes', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    await openCanvasPage(page, canvas.origin);
    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    expect(await savedAddress(background)).toBe(canvas.origin);
    const canvasWindow = await windowOfTab(background, `${canvas.origin}/*`);

    const panel = await openPanelTab(context, background, extensionUrl('sidepanel.html'), {
      windowId: canvasWindow,
    });
    await expect(doneBox(panel, QUIZ_3)).toBeVisible();

    await expect(list).toHaveText(SHOWN_IN_PANEL);
    await expect(doneBox(list, QUIZ_3)).toHaveCount(0);

    // A panel in another window changes nothing here.
    const elsewhere = await openPanelTab(context, background, extensionUrl('sidepanel.html'), {
      newWindow: true,
    });
    await expect(doneBox(elsewhere, QUIZ_3)).toBeVisible();
    await expect(list).toHaveText(SHOWN_IN_PANEL);

    await panel.close();

    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await expect(list.getByText(SHOWN_IN_PANEL)).toHaveCount(0);
    // The panel in the other window is still open, and this list stays expanded.
    await expect(doneBox(elsewhere, QUIZ_3)).toBeVisible();
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
  });
});

test.describe('course home page', () => {
  test('shows only that course, and the rows leave out the course name', async ({
    context,
    page,
  }) => {
    const { canvas, scenario } = await serveScenario(context, [
      { path: `/courses/${IDS.courses.biology}`, page: 'course-home' },
    ]);
    await openCanvasPage(page, canvas.origin, `/courses/${IDS.courses.biology}`);
    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();

    await expandEverything(list);

    const biology = courseTitles(scenario, IDS.courses.biology);
    const titles = await list.locator('[data-part="title"]').allTextContents();
    expect(titles.length).toBeGreaterThan(5);
    for (const title of titles) expect(biology, title).toContain(title);
    for (const other of ['Lab 7: Titration notebook', 'Problem set 6', 'Return library books']) {
      await expect(list.getByText(other)).toHaveCount(0);
    }
    await expect(list.locator('.wr-course')).toHaveCount(0);
    await expect(list.getByText('BIO 110: Principles of Biology')).toHaveCount(0);
    await expect(page.locator('#right-side .Sidebar__TodoListContainer')).toBeHidden();
  });

  test('shows a note with a settings link on the home page of a hidden course, and the native To Do stays', async ({
    context,
    page,
    background,
    extensionUrl,
  }) => {
    const { canvas } = await serveScenario(context, [
      { path: `/courses/${IDS.courses.club}`, page: 'course-home-hidden-course' },
    ]);
    await saveAddress(background, canvas.origin);
    await saveSettings(background, { ...DEFAULT_SETTINGS, hiddenCourseIds: [IDS.courses.club] });

    await openCanvasPage(page, canvas.origin, `/courses/${IDS.courses.club}`);

    const list = inpageList(page);
    await expect(list.getByText('You hid this course in Weekrow.')).toBeVisible();
    await expect(list.getByRole('checkbox')).toHaveCount(0);
    await expect(page.locator('#right-side .Sidebar__TodoListContainer')).toBeVisible();
    await expect(page.locator('#weekrow-hide-native-todo')).toHaveCount(0);

    const opened = context.waitForEvent('page');
    await list.getByRole('button', { name: 'Settings' }).click();
    const settings = await opened;
    await expect(settings).toHaveURL(extensionUrl('options.html'));
  });
});

test.describe('pages with other layouts', () => {
  test('mounts above the teacher To Do on a mixed-role dashboard, and the teacher To Do stays', async ({
    context,
    page,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-mixed-role' }]);

    await openCanvasPage(page, canvas.origin);

    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();
    await expect(page.locator('#right-side-wrapper > #weekrow-inpage + #right-side')).toHaveCount(
      1,
    );
    const teacherHeader = page.locator('#right-side h2.todo-list-header');
    await expect(teacherHeader).toBeVisible();
    await expect(page.locator('#right-side ul.to-do-list')).toBeVisible();
    const listBox = await list.boundingBox();
    const headerBox = await teacherHeader.boundingBox();
    expect(listBox?.y ?? Infinity).toBeLessThan(headerBox?.y ?? 0);
  });

  test('adds nothing to a K-5 course home page', async ({ context, page, background }) => {
    const { canvas } = await serveScenario(context, [
      { path: '/courses/107', page: 'course-home-k5' },
    ]);
    const ran = await watchContentScript(page);

    await openCanvasPage(page, canvas.origin, '/courses/107');

    await expect.poll(ran).toBe(true);
    // The page is Canvas, so the content script saved the address and told the background.
    await expect.poll(() => savedAddress(background)).toBe(canvas.origin);
    await expect
      .poll(() => canvas.requests.some((r) => r.path.startsWith('/api/v1/planner/items')))
      .toBe(true);
    await expect(page.locator('#weekrow-inpage')).toHaveCount(0);
    await expect(page.locator('weekrow-list')).toHaveCount(0);
    await expect(page.locator('#weekrow-hide-native-todo')).toHaveCount(0);
  });

  test('adds nothing to a page that is not Canvas, and does not take it for Canvas', async ({
    context,
    page,
    background,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    const notCanvas = readPageFixture('not-canvas');
    for (const origin of ['https://news.northfield.edu', 'https://www.instructure.com']) {
      await context.route(`${origin}/**`, (route) =>
        route.fulfill({ contentType: 'text/html; charset=utf-8', body: notCanvas }),
      );
    }

    // The school's news site: the extension has no access there.
    await page.goto('https://news.northfield.edu/');
    await expect(page.locator('h1')).toHaveText('Campus News');
    await expect(page.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);

    // An instructure.com page that is not Canvas: the content script runs, and saves nothing.
    const ran = await watchContentScript(page);
    await page.goto('https://www.instructure.com/');
    await expect.poll(ran).toBe(true);
    const canvasTab = await context.newPage();
    await openCanvasPage(canvasTab, canvas.origin);
    await expect(doneBox(inpageList(canvasTab), QUIZ_3)).toBeVisible();
    // The real Canvas, visited later, took the empty address slot.
    expect(await savedAddress(background)).toBe(canvas.origin);
    await expect(page.locator('#weekrow-inpage, weekrow-list')).toHaveCount(0);
  });
});

test.describe('compact in-page list', () => {
  test('a group with more than 4 items shows 3 rows and "Show N more"', async ({
    context,
    page,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    await openCanvasPage(page, canvas.origin);
    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();

    // Past due has 6 items in full, and Tomorrow has 6.
    for (const kind of ['past_due', 'tomorrow']) {
      const section = group(list, kind);
      await expect(mainRows(section), kind).toHaveCount(3);
      const more = section.getByRole('button', { name: 'Show 3 more' });
      await expect(more, kind).toBeVisible();
      await more.click();
      await expect(mainRows(section), kind).toHaveCount(6);
      await expect(more, kind).toHaveCount(0);
    }
  });

  // Design decision 4 cuts only groups with more than 4 items, because a link that hides one
  // item takes the same space as that item.
  test('a group of 4 items shows all 4 rows with no "Show more"', async ({ context, page }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-card-view' }]);
    await openCanvasPage(page, canvas.origin);
    const list = inpageList(page);
    await expect(doneBox(list, QUIZ_3)).toBeVisible();

    // Today has 4 items: Quiz 3, Return library books, Participation: Week 9 and Debate 2.
    // The list renders each group in one pass, so these counts need no waiting.
    const today = group(list, 'today');
    expect(await today.getByRole('button', { name: /^Show \d+ more$/ }).count()).toBe(0);
    expect(await mainRows(today).count()).toBe(4);
  });
});
