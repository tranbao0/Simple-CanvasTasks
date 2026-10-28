// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_CSS, installStyles, PAGE_CSS } from './styles';

/** Vitest does not process CSS, so the sheets are read as the build reads them. */
const listSheet = readFileSync(path.join(import.meta.dirname, 'styles.css'), 'utf8');
const pageSheet = readFileSync(path.join(import.meta.dirname, 'pages.css'), 'utf8');

/** Selectors that only the settings page, the welcome page or the first-run steps use. */
const PAGE_ONLY = ['.wr-switch', '.wr-page', '.wr-setting', '.wr-step', '.wr kbd', ':root'];

describe('stylesheets', () => {
  it('keeps the page rules out of the in-page sheet', () => {
    for (const selector of PAGE_ONLY) {
      expect(listSheet, selector).not.toContain(selector);
      expect(pageSheet, selector).toContain(selector);
    }
    expect(listSheet).toContain('.wr-item');
    expect(pageSheet).not.toContain('.wr-item');
  });

  it('adds the list sheet, then the page sheet, to an extension page once', () => {
    document.head.innerHTML = '';
    installStyles(document);
    installStyles(document);
    const styles = document.head.querySelectorAll('style[data-weekrow]');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe(`${APP_CSS}\n${PAGE_CSS}`);
  });
});
