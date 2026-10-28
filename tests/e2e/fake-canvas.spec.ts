import { expect, test } from './support/extension';
import { serveFakeCanvas } from './support/fake-canvas';

test('the fake Canvas answers the page, the extension and its service worker', async ({
  context,
  page,
  serviceWorker,
}) => {
  const canvas = await serveFakeCanvas(context, [
    {
      path: '/',
      body: '<!doctype html><title>Dashboard</title><h1>Dashboard</h1>',
      contentType: 'text/html',
    },
    { path: '/api/v1/users/self', body: { id: '1', name: 'Sam Student' } },
    {
      method: 'PUT',
      path: /^\/api\/v1\/planner\/overrides\/\d+$/,
      body: { id: '7', marked_complete: true },
    },
  ]);

  await page.goto(`${canvas.origin}/`);
  await expect(page.locator('h1')).toHaveText('Dashboard');

  const user = await page.evaluate(async () => (await fetch('/api/v1/users/self')).json());
  expect(user).toEqual({ id: '1', name: 'Sam Student' });

  const write = await serviceWorker.evaluate(async (url) => {
    const response = await fetch(url, { method: 'PUT', body: 'marked_complete=true' });
    return { status: response.status, body: await response.json() };
  }, `${canvas.origin}/api/v1/planner/overrides/7`);
  expect(write).toEqual({ status: 200, body: { id: '7', marked_complete: true } });
  expect(canvas.requests).toContainEqual(
    expect.objectContaining({
      method: 'PUT',
      path: '/api/v1/planner/overrides/7',
      postData: 'marked_complete=true',
    }),
  );

  const missing = await page.evaluate(async () => (await fetch('/api/v1/courses')).status);
  expect(missing).toBe(404);
  expect(canvas.unmatched).toContainEqual(expect.objectContaining({ path: '/api/v1/courses' }));

  const outside = await page.evaluate(() =>
    fetch('https://tracker.example/collect').then(
      () => 'reached',
      () => 'blocked',
    ),
  );
  expect(outside).toBe('blocked');
  expect(canvas.blocked).toContainEqual(
    expect.objectContaining({ url: 'https://tracker.example/collect' }),
  );
});
