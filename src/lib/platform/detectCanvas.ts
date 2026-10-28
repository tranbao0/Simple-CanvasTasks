/**
 * Detects a Canvas page. See docs/design.md, decisions 4 and 5.
 *
 * `isCanvasDocument` runs in two places: in a content script, and in a web page through
 * `scripting.executeScript({ func: isCanvasDocument })`. The browser serializes an injected
 * function to text, so it must stay self-contained: it may use only its own parameter, its
 * own local names and page globals, never imports or other names from this module.
 */

/**
 * Whether the document is a Canvas LMS page.
 *
 * Canvas signs:
 * - `#application.ic-app`, the root of the normal Canvas layout;
 * - the inline head script that assigns both `INST` and `ENV`, which every Canvas layout has;
 * - the `_csrf_token` cookie together with an inline script that assigns `ENV`, which covers
 *   the small Canvas layouts that lack the other two signs.
 *
 * Called with no argument, it checks the global `document` of the page it runs in.
 */
export function isCanvasDocument(doc: Document = document): boolean {
  const app = doc.getElementById('application');
  if (app !== null && app.classList.contains('ic-app')) return true;

  let assignsEnv = false;
  const scripts = doc.querySelectorAll('script:not([src])');
  for (const script of Array.from(scripts)) {
    const text = script.textContent ?? '';
    const env = /(?:^|[\s;])ENV\s*=/.test(text);
    if (env && /(?:^|[\s;])INST\s*=/.test(text)) return true;
    assignsEnv = assignsEnv || env;
  }

  let cookies = '';
  try {
    cookies = doc.cookie;
  } catch {
    // A sandboxed document throws on cookie access.
  }
  return assignsEnv && /(?:^|;\s*)_csrf_token=/.test(cookies);
}
