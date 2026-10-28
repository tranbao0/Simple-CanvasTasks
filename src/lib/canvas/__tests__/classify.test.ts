import { describe, expect, it } from 'vitest';
import {
  classifyHttpFailure,
  parseCanvasJson,
  parseRetryAfter,
  stripJsonPrefix,
} from '../classify';
import type { CanvasErrorKind } from '../types';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

describe('stripJsonPrefix', () => {
  it('removes a leading while(1); guard', () => {
    expect(stripJsonPrefix('while(1);{"a":1}')).toBe('{"a":1}');
  });

  it('removes the guard after leading whitespace', () => {
    expect(stripJsonPrefix('\n while(1);[1]')).toBe('[1]');
  });

  it('keeps a body without the guard', () => {
    expect(stripJsonPrefix('{"a":"while(1);"}')).toBe('{"a":"while(1);"}');
  });
});

describe('parseCanvasJson', () => {
  it('parses guarded JSON', () => {
    expect(parseCanvasJson('while(1);[{"id":"1"}]')).toEqual({ ok: true, value: [{ id: '1' }] });
  });

  it('parses an empty body as null', () => {
    expect(parseCanvasJson('  ')).toEqual({ ok: true, value: null });
  });

  it('fails on HTML', () => {
    expect(parseCanvasJson('<!doctype html><title>Login</title>')).toEqual({ ok: false });
  });
});

describe('parseRetryAfter', () => {
  it('reads delay seconds', () => {
    expect(parseRetryAfter('5', NOW)).toBe(5000);
    expect(parseRetryAfter(' 1.5 ', NOW)).toBe(1500);
  });

  it('reads an HTTP date relative to now', () => {
    expect(parseRetryAfter(new Date(NOW + 7000).toUTCString(), NOW)).toBe(7000);
  });

  it('gives zero for a date in the past', () => {
    expect(parseRetryAfter(new Date(NOW - 7000).toUTCString(), NOW)).toBe(0);
  });

  it('ignores a missing or unreadable header', () => {
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
    expect(parseRetryAfter('soon', NOW)).toBeUndefined();
    expect(parseRetryAfter('-3', NOW)).toBeUndefined();
  });
});

describe('classifyHttpFailure', () => {
  const unauthorizedJson = JSON.stringify({
    status: 'unauthorized',
    errors: [{ message: 'user not authorized to perform that action' }],
  });

  const cases: ReadonlyArray<readonly [string, number, string, CanvasErrorKind]> = [
    ['401', 401, '{"status":"unauthenticated"}', 'unauthorized'],
    ['403 with JSON status unauthorized', 403, unauthorizedJson, 'forbidden'],
    ['403 with guarded JSON', 403, `while(1);${unauthorizedJson}`, 'forbidden'],
    ['403 Rate Limit Exceeded text', 403, '403 Forbidden (Rate Limit Exceeded)\n', 'rate_limited'],
    ['403 with an HTML page', 403, '<html>Access denied</html>', 'not_canvas'],
    ['429', 429, '429 Too Many Requests (Rate Limit Exceeded)\n', 'rate_limited'],
    ['429 with no body', 429, '', 'rate_limited'],
    ['404', 404, '{"errors":[{"message":"The specified resource does not exist."}]}', 'not_found'],
    ['400', 400, '{"message":"Invalid assignment_ids: 7"}', 'bad_request'],
    ['422', 422, '<html>Invalid authenticity token</html>', 'bad_request'],
    ['500', 500, '{"errors":{"base":"Unexpected error"}}', 'server'],
    ['502', 502, '<html>Bad gateway</html>', 'server'],
    ['503', 503, '', 'server'],
    ['302', 302, '', 'redirect'],
  ];

  it.each(cases)('classifies %s', (_name, status, body, kind) => {
    const error = classifyHttpFailure(status, body, null, NOW);
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
  });

  it('keeps Retry-After on a rate limit', () => {
    expect(classifyHttpFailure(429, '', '12', NOW).retryAfterMs).toBe(12_000);
    expect(classifyHttpFailure(403, 'Rate Limit Exceeded', '2', NOW).retryAfterMs).toBe(2000);
  });

  it('leaves retryAfterMs empty on other errors', () => {
    expect(classifyHttpFailure(500, '', '12', NOW).retryAfterMs).toBeUndefined();
  });
});
