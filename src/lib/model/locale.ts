/**
 * Locale rules that Canvas itself uses: the first day of the week and the 12-hour or 24-hour clock.
 * Both tables come from canvas-lms `config/locales/locales.yml`.
 */
import type { IsoDayOfWeek, Settings } from './types';

/** Canvas `dow_offset`: 0 is Sunday, 1 is Monday, 6 is Saturday. */
type DowOffset = 0 | 1 | 6;

/**
 * `dow_offset` for every locale in canvas-lms `config/locales/locales.yml`.
 * Canvas reads the value with no fallback, so a listed locale without `dow_offset` starts on Sunday.
 * Keys are lower case.
 */
const CANVAS_DOW_OFFSET: Readonly<Record<string, DowOffset>> = {
  ar: 6,
  ca: 1,
  cy: 1,
  da: 1,
  'da-x-k12': 1,
  de: 1,
  el: 1,
  en: 0,
  'en-au': 1,
  'en-ca': 0,
  'en-gb': 1,
  es: 1,
  'es-es': 1,
  fa: 6,
  fi: 1,
  fr: 1,
  'fr-ca': 0,
  ga: 1,
  he: 0,
  hi: 0,
  ht: 0,
  hu: 1,
  hy: 1,
  id: 1,
  is: 1,
  it: 1,
  ja: 0,
  ko: 0,
  mi: 0,
  ms: 1,
  nb: 1,
  'nb-x-k12': 1,
  nl: 1,
  nn: 1,
  pl: 1,
  pt: 1,
  'pt-br': 0,
  ru: 1,
  sl: 0,
  sv: 1,
  'sv-x-k12': 1,
  th: 1,
  tr: 1,
  uk: 1,
  vi: 1,
  'zh-hans': 1,
  'zh-hant': 1,
};

/**
 * The clock of each Canvas locale, from its `time.formats.tiny` pattern.
 * `%l` is a 12-hour pattern; `%k` and `%H` are 24-hour patterns. `en` uses the 12-hour default.
 */
const CANVAS_HOUR_CYCLE: Readonly<Record<string, 'h12' | 'h23'>> = {
  ar: 'h23',
  ca: 'h23',
  cy: 'h23',
  da: 'h23',
  'da-x-k12': 'h23',
  de: 'h23',
  el: 'h12',
  en: 'h12',
  'en-au': 'h23',
  'en-ca': 'h12',
  'en-gb': 'h23',
  es: 'h23',
  'es-es': 'h23',
  fa: 'h12',
  fi: 'h23',
  fr: 'h23',
  'fr-ca': 'h23',
  ga: 'h23',
  he: 'h23',
  hi: 'h12',
  ht: 'h23',
  hu: 'h23',
  hy: 'h23',
  id: 'h23',
  is: 'h23',
  it: 'h23',
  ja: 'h23',
  ko: 'h12',
  mi: 'h12',
  ms: 'h12',
  nb: 'h23',
  'nb-x-k12': 'h23',
  nl: 'h23',
  nn: 'h23',
  pl: 'h23',
  pt: 'h23',
  'pt-br': 'h23',
  ru: 'h23',
  sl: 'h23',
  sv: 'h23',
  'sv-x-k12': 'h23',
  th: 'h23',
  tr: 'h23',
  uk: 'h23',
  vi: 'h23',
  'zh-hans': 'h23',
  'zh-hant': 'h23',
};

/**
 * Lookup keys for a locale tag, most specific first: `en-GB-x-ukhe` gives
 * `en-gb-x-ukhe`, `en-gb-x`, `en-gb`, `en`.
 */
export function localeCandidates(locale: string): string[] {
  const parts = locale.trim().toLowerCase().replaceAll('_', '-').split('-').filter(Boolean);
  const candidates: string[] = [];
  for (let length = parts.length; length > 0; length--) {
    candidates.push(parts.slice(0, length).join('-'));
  }
  return candidates;
}

function lookup<T>(table: Readonly<Record<string, T>>, locale: string): T | undefined {
  for (const candidate of localeCandidates(locale)) {
    const value = table[candidate];
    if (value !== undefined) return value;
  }
  return undefined;
}

function isoDayFromDowOffset(offset: DowOffset): IsoDayOfWeek {
  switch (offset) {
    case 0:
      return 7;
    case 1:
      return 1;
    case 6:
      return 6;
  }
}

/**
 * The first day of the week. `auto` uses the Canvas mapping for the locale, and Sunday
 * for a locale that Canvas does not list.
 */
export function resolveWeekStartDay(
  setting: Settings['weekStart'],
  effectiveLocale: string,
): IsoDayOfWeek {
  if (setting !== 'auto') return setting;
  return isoDayFromDowOffset(lookup(CANVAS_DOW_OFFSET, effectiveLocale) ?? 0);
}

function intlHourCycle(locale: string): 'h12' | 'h23' {
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h23' || cycle === 'h24' ? 'h23' : 'h12';
  } catch {
    return 'h12';
  }
}

/** The clock that Canvas uses for the locale. Locales that Canvas does not list use the browser's locale data. */
export function hourCycleFor(locale: string): 'h12' | 'h23' {
  return lookup(CANVAS_HOUR_CYCLE, locale) ?? intlHourCycle(locale);
}

/** The Canvas language: `effective_locale`, then `locale`, then the browser language, then `en`. */
export function resolveLocale(
  profile: { effective_locale?: string | null; locale?: string | null },
  browserLanguage?: string | null,
): string {
  const candidates = [profile.effective_locale, profile.locale, browserLanguage];
  for (const candidate of candidates) {
    if (candidate && candidate.trim() !== '') return candidate.trim();
  }
  return 'en';
}
