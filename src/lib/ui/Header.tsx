/** The week header: range, week arrows, "This week", add task and settings. */
import { t } from '../i18n';
import type { WeekView } from '../model/types';
import { formatWeekRange, formatWeekRangeLong, timeZoneLabel } from './format';
import { ChevronLeftIcon, ChevronRightIcon, GearIcon, PlusIcon, TodayIcon } from './icons';
import { Heading, type HeadingLevel } from './parts';

export interface HeaderProps {
  /** `null` while loading: the header keeps its final layout with a placeholder range. */
  view: WeekView | null;
  level: HeadingLevel;
  refreshing: boolean;
  /** Set when adding a task is not possible, with the reason. */
  addDisabledReason: string | null;
  addDescribedBy?: string;
  onWeek(offset: number): void;
  onAdd(): void;
  onSettings(): void;
}

export function Header(props: HeaderProps) {
  const { view } = props;
  const offset = view?.weekOffset ?? 0;
  const addDisabled = view === null || props.addDisabledReason !== null;
  const thisWeekOff = view === null || view.isCurrentWeek;
  const zoneInstant = view ? `${view.today}T12:00:00Z` : '';
  return (
    <header class="wr-header">
      <div class="wr-header-top">
        <Heading level={props.level} class="wr-range">
          {view ? (
            <>
              <span aria-hidden="true">{formatWeekRange(view.weekStart, view.weekEnd)}</span>
              <span class="wr-sr">{formatWeekRangeLong(view.weekStart, view.weekEnd)}</span>
            </>
          ) : (
            <span class="wr-skel wr-skel-range" />
          )}
        </Heading>
        <div class="wr-toolbar">
          <button
            type="button"
            class="wr-icon-btn wr-add"
            aria-label={t('addTask')}
            aria-disabled={addDisabled}
            aria-describedby={props.addDisabledReason ? props.addDescribedBy : undefined}
            title={props.addDisabledReason ?? t('addTask')}
            onClick={() => {
              if (!addDisabled) props.onAdd();
            }}
          >
            <PlusIcon />
            <span class="wr-btn-label" aria-hidden="true">
              {t('addTask')}
            </span>
          </button>
          <button
            type="button"
            class="wr-icon-btn"
            aria-label={t('settings')}
            title={t('settings')}
            onClick={props.onSettings}
          >
            <GearIcon />
          </button>
        </div>
      </div>
      <div class="wr-header-nav">
        <div class="wr-nav" role="group" aria-label={t('weekNav')}>
          <button
            type="button"
            aria-label={t('prevWeek')}
            title={t('prevWeek')}
            disabled={view === null}
            onClick={() => props.onWeek(offset - 1)}
          >
            <ChevronLeftIcon />
          </button>
          {/*
           * aria-disabled, not disabled: a disabled button drops focus, and this one turns off
           * while it has focus, when it brings the student back to the current week.
           */}
          <button
            type="button"
            class="wr-this-week"
            title={t('thisWeek')}
            aria-disabled={thisWeekOff}
            onClick={() => {
              if (!thisWeekOff) props.onWeek(0);
            }}
          >
            <TodayIcon />
            <span class="wr-btn-label">{t('thisWeek')}</span>
          </button>
          <button
            type="button"
            aria-label={t('nextWeek')}
            title={t('nextWeek')}
            disabled={view === null}
            onClick={() => props.onWeek(offset + 1)}
          >
            <ChevronRightIcon />
          </button>
        </div>
        {view?.browserTimeZoneDiffers && (
          <span class="wr-tz" title={t('timesInLong', view.timeZone)}>
            {t('timesIn', timeZoneLabel(view.timeZone, zoneInstant))}
          </span>
        )}
      </div>
      {props.refreshing && (
        <div class="wr-progress" role="progressbar" aria-label={t('refreshing')} />
      )}
    </header>
  );
}
