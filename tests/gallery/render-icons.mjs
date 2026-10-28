// Renders the app icon SVGs in tests/gallery/icons/ to the PNG files that WXT
// picks up by name: src/public/icon/16.png, 32.png, 48.png and 128.png.
// The 16 px icon uses the simpler ring-only drawing, which stays sharp at that size.
//
// Usage: node tests/gallery/render-icons.mjs
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const iconDir = fileURLToPath(new URL('./icons/', import.meta.url));
const outDir = fileURLToPath(new URL('../../src/public/icon/', import.meta.url));
const targets = [
  { size: 16, source: 'icon-small.svg' },
  { size: 32, source: 'icon.svg' },
  { size: 48, source: 'icon.svg' },
  { size: 128, source: 'icon.svg' },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const { size, source } of targets) {
    const svg = await readFile(`${iconDir}${source}`, 'utf8');
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`,
    );
    await page.screenshot({
      path: `${outDir}${size}.png`,
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`Rendered ${targets.length} icons to ${outDir}`);
