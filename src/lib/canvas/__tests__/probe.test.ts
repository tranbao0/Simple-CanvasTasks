import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { CANVAS_ACCEPT } from '../http';
import { probeCanvas, probeResultFor } from '../probe';
import { api, ORIGIN, useMswServer } from './support';

const server = useMswServer();

function answer(respond: () => Response): void {
  server.use(http.get(api('/api/v1/users/self'), respond));
}

describe('probeCanvas', () => {
  it('is canvas on 200 with user JSON', async () => {
    answer(() => HttpResponse.json({ id: '12', name: 'Ada' }));
    await expect(probeCanvas(ORIGIN)).resolves.toBe('canvas');
  });

  it('strips while(1); from the user JSON', async () => {
    answer(
      () =>
        new HttpResponse('while(1);{"id":"12","name":"Ada"}', {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(probeCanvas(ORIGIN)).resolves.toBe('canvas');
  });

  it('is signed_out on 401 with the canvas-lms realm', async () => {
    answer(() =>
      HttpResponse.json(
        { status: 'unauthenticated', errors: [{ message: 'user authorization required' }] },
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="canvas-lms"' } },
      ),
    );
    await expect(probeCanvas(ORIGIN)).resolves.toBe('signed_out');
  });

  it('is not_canvas on 401 without the canvas-lms realm', async () => {
    answer(() =>
      HttpResponse.text('no', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="intranet"' },
      }),
    );
    await expect(probeCanvas(ORIGIN)).resolves.toBe('not_canvas');
    answer(() => HttpResponse.text('no', { status: 401 }));
    await expect(probeCanvas(ORIGIN)).resolves.toBe('not_canvas');
  });

  it('is redirects on a redirect response', async () => {
    answer(() =>
      HttpResponse.text('', { status: 302, headers: { Location: 'https://school.edu/login' } }),
    );
    await expect(probeCanvas(ORIGIN)).resolves.toBe('redirects');
  });

  it('is redirects on an opaque redirect', async () => {
    const opaque = Response.error();
    Object.defineProperty(opaque, 'type', { value: 'opaqueredirect' });
    await expect(probeCanvas(ORIGIN, () => Promise.resolve(opaque))).resolves.toBe('redirects');
  });

  it('is network when the fetch fails', async () => {
    answer(() => HttpResponse.error());
    await expect(probeCanvas(ORIGIN)).resolves.toBe('network');
  });

  it.each([
    ['an HTML page', () => HttpResponse.html('<html>Welcome to our school</html>')],
    ['JSON without a user id', () => HttpResponse.json({ name: 'not a user' })],
    ['a JSON list', () => HttpResponse.json([{ id: '1' }])],
    ['404', () => HttpResponse.html('Not found', { status: 404 })],
    ['503', () => HttpResponse.html('<h1>Canvas Lite is live!</h1>', { status: 503 })],
  ])('is not_canvas for %s', async (_name, respond) => {
    answer(respond);
    await expect(probeCanvas(ORIGIN)).resolves.toBe('not_canvas');
  });

  it('is not_canvas for an address that is not an https origin, without a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(probeCanvas('file:///tmp/x', fetchImpl)).resolves.toBe('not_canvas');
    await expect(probeCanvas('nonsense', fetchImpl)).resolves.toBe('not_canvas');
    await expect(probeCanvas('http://school.instructure.com', fetchImpl)).resolves.toBe(
      'not_canvas',
    );
    await expect(probeCanvas('http://10.0.0.5', fetchImpl)).resolves.toBe('not_canvas');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends one GET to users/self on the origin with the wrapper options', async () => {
    answer(() => HttpResponse.json({ id: '12' }));
    const fetchImpl = vi.fn<typeof fetch>((input, init) => globalThis.fetch(input, init));
    await probeCanvas(`${ORIGIN}/login/canvas`, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toEqual([
      api('/api/v1/users/self'),
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        redirect: 'manual',
        headers: { Accept: CANVAS_ACCEPT },
      }),
    ]);
  });
});

describe('probeResultFor', () => {
  it('accepts numeric user ids', () => {
    expect(probeResultFor(200, null, '{"id":12}')).toBe('canvas');
  });

  it('matches the realm without regard to case', () => {
    expect(probeResultFor(401, 'Bearer REALM="CANVAS-LMS"', '')).toBe('signed_out');
  });
});
