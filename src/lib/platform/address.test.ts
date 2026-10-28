import { describe, expect, it } from 'vitest';
import {
  isInstructureHost,
  isTestOrBetaHost,
  normalizeAddress,
  originHostname,
  originMatchPattern,
} from './address';

describe('normalizeAddress', () => {
  it.each([
    ['canvas.school.edu', 'https://canvas.school.edu'],
    ['  canvas.school.edu  ', 'https://canvas.school.edu'],
    ['https://canvas.school.edu', 'https://canvas.school.edu'],
    ['https://canvas.school.edu/', 'https://canvas.school.edu'],
    ['https://canvas.school.edu/courses/12/assignments?x=1#top', 'https://canvas.school.edu'],
    ['canvas.school.edu/courses/12', 'https://canvas.school.edu'],
    ['canvas.school.edu?login_success=1', 'https://canvas.school.edu'],
    ['canvas.school.edu#hash', 'https://canvas.school.edu'],
    ['HTTPS://Canvas.School.EDU/Dashboard', 'https://canvas.school.edu'],
    ['School.Instructure.com', 'https://school.instructure.com'],
    ['  School.Instructure.com/  ', 'https://school.instructure.com'],
    ['http://canvas.school.edu/login', 'https://canvas.school.edu'],
    ['canvas.school.edu.', 'https://canvas.school.edu'],
    ['canvas.school.edu:8443/courses', 'https://canvas.school.edu:8443'],
    ['https://canvas.school.edu:443', 'https://canvas.school.edu'],
    ['canvas.school.edu:', 'https://canvas.school.edu'],
    ['https://user:secret@canvas.school.edu/', 'https://canvas.school.edu'],
    ['café.example.edu', 'https://xn--caf-dma.example.edu'],
  ])('reduces %j to %j', (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['ftp://canvas.school.edu'],
    ['file:///home/me/canvas.html'],
    ['javascript:alert(1)'],
    ['mailto:help@school.edu'],
    ['chrome-extension://abc/sidepanel.html'],
    ['localhost'],
    ['localhost:3000'],
    ['canvas'],
    ['https://canvas/'],
    ['192.168.1.20'],
    ['https://10.0.0.1/courses'],
    ['0x7f.1'],
    ['[::1]'],
    ['https://[2001:db8::1]/'],
    ['canvas school.edu'],
    ['not a host.com'],
    ['https://'],
    ['.school.edu'],
    ['canvas.school.edu..'],
    ['canvas..school.edu'],
    ['https://canvas..school.edu/login'],
  ])('rejects %j', (input) => {
    expect(normalizeAddress(input)).toBeNull();
  });
});

describe('isInstructureHost', () => {
  it.each([
    ['https://school.instructure.com', true],
    ['https://school.test.instructure.com', true],
    ['https://instructure.com', true],
    ['https://canvas.school.edu', false],
    ['https://notinstructure.com', false],
    ['https://instructure.com.evil.example', false],
    ['not an origin', false],
  ])('%s gives %s', (origin, expected) => {
    expect(isInstructureHost(origin)).toBe(expected);
  });
});

describe('isTestOrBetaHost', () => {
  it.each([
    ['https://school.test.instructure.com', true],
    ['https://school.beta.instructure.com', true],
    ['https://school.instructure.com', false],
    ['https://test.instructure.com', false],
    ['https://canvas.test.school.edu', false],
    ['not an origin', false],
  ])('%s gives %s', (origin, expected) => {
    expect(isTestOrBetaHost(origin)).toBe(expected);
  });
});

describe('originMatchPattern', () => {
  it('matches every page of the origin', () => {
    expect(originMatchPattern('https://canvas.school.edu')).toBe('https://canvas.school.edu/*');
  });

  it('leaves out the port, which match patterns do not need', () => {
    expect(originMatchPattern('https://canvas.school.edu:8443')).toBe(
      'https://canvas.school.edu/*',
    );
  });

  it('gives null for text that is not an origin', () => {
    expect(originMatchPattern('nope')).toBeNull();
  });
});

describe('originHostname', () => {
  it('reads the host name', () => {
    expect(originHostname('https://canvas.school.edu:8443')).toBe('canvas.school.edu');
    expect(originHostname('nope')).toBeNull();
  });
});
