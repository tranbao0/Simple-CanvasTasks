import { expect, test } from './support/extension';

test('the side panel page renders in a tab', async ({ page, extensionUrl }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(extensionUrl('sidepanel.html'));

  await expect(page.locator('#app')).not.toBeEmpty();
  expect(errors).toEqual([]);
});
