import { browser, type Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { csrfFromCookiesApi, csrfFromDocumentCookie, decodeCookieValue, findCookie } from '../csrf';
import { CSRF_TOKEN, ORIGIN } from './support';

const ENCODED = encodeURIComponent(CSRF_TOKEN);

type Cookie = Browser.cookies.Cookie;
type CookieLookup = (details: Browser.cookies.CookieDetails) => Promise<Cookie | null | undefined>;

/** `spyOn` types an overloaded function by its last overload, the callback form, so the spy is retyped to the promise form. */
function mockCookieLookup(result: Cookie | null): MockInstance<CookieLookup> {
  return (
    vi.spyOn(browser.cookies, 'get') as unknown as MockInstance<CookieLookup>
  ).mockResolvedValue(result);
}

function cookie(value: string): Cookie {
  return {
    name: '_csrf_token',
    value,
    domain: 'school.instructure.com',
    hostOnly: true,
    path: '/',
    secure: true,
    httpOnly: false,
    sameSite: 'lax' as Browser.cookies.SameSiteStatus,
    session: true,
    storeId: '0',
  };
}

describe('findCookie and decodeCookieValue', () => {
  it('finds a cookie by its exact name', () => {
    const cookies = `x_csrf_token=nope; _csrf_token=${ENCODED}; _csrf_token_other=nope`;
    expect(findCookie(cookies, '_csrf_token')).toBe(ENCODED);
    expect(findCookie('a=1; b=2', '_csrf_token')).toBeNull();
    expect(findCookie('', '_csrf_token')).toBeNull();
  });

  it('keeps "=" inside the value', () => {
    expect(findCookie('_csrf_token=ab==; z=1', '_csrf_token')).toBe('ab==');
  });

  it('URL-decodes, and gives null for empty or malformed values', () => {
    expect(decodeCookieValue(ENCODED)).toBe(CSRF_TOKEN);
    expect(decodeCookieValue('')).toBeNull();
    expect(decodeCookieValue(undefined)).toBeNull();
    expect(decodeCookieValue('%E0%A4%A')).toBeNull();
  });
});

describe('csrfFromDocumentCookie', () => {
  it('reads the current cookie on every call', async () => {
    const doc = { cookie: `_csrf_token=${ENCODED}` };
    const source = csrfFromDocumentCookie(doc);
    await expect(source()).resolves.toBe(CSRF_TOKEN);
    doc.cookie = 'other=1';
    await expect(source()).resolves.toBeNull();
  });
});

describe('csrfFromCookiesApi', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('reads _csrf_token for the origin with the cookies API and decodes it', async () => {
    const get = mockCookieLookup(cookie(ENCODED));
    await expect(csrfFromCookiesApi(ORIGIN)()).resolves.toBe(CSRF_TOKEN);
    expect(get).toHaveBeenCalledWith({ url: `${ORIGIN}/`, name: '_csrf_token' });
  });

  it('gives null when the cookie is missing', async () => {
    mockCookieLookup(null);
    await expect(csrfFromCookiesApi(ORIGIN)()).resolves.toBeNull();
  });

  it('uses only the origin of the address', async () => {
    const get = mockCookieLookup(null);
    await csrfFromCookiesApi(`${ORIGIN}/courses/1`)();
    expect(get).toHaveBeenCalledWith({ url: `${ORIGIN}/`, name: '_csrf_token' });
  });

  it('refuses an http origin', () => {
    const get = mockCookieLookup(cookie(ENCODED));
    expect(() => csrfFromCookiesApi('http://school.instructure.com')).toThrow(
      expect.objectContaining({ kind: 'origin_blocked' }),
    );
    expect(get).not.toHaveBeenCalled();
  });
});
