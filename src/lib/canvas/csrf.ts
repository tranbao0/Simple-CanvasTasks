import { browser } from 'wxt/browser';
import { toCanvasOrigin } from './http';
import type { CsrfTokenSource } from './types';

export const CSRF_COOKIE_NAME = '_csrf_token';

/** URL-decodes a cookie value. An empty or malformed value gives null. */
export function decodeCookieValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return null;
  }
}

/** Finds a cookie's raw value in a `document.cookie` string. */
export function findCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

/** Reads the CSRF token from the page's cookies. For content scripts on the Canvas page. */
export function csrfFromDocumentCookie(doc: Pick<Document, 'cookie'>): CsrfTokenSource {
  return () => Promise.resolve(decodeCookieValue(findCookie(doc.cookie, CSRF_COOKIE_NAME)));
}

/** Reads the CSRF token with the `cookies` API. For extension pages and the background. */
export function csrfFromCookiesApi(origin: string): CsrfTokenSource {
  const url = `${toCanvasOrigin(origin)}/`;
  return async () => {
    const cookie = await browser.cookies.get({ url, name: CSRF_COOKIE_NAME });
    return decodeCookieValue(cookie?.value);
  };
}
