/** The settings page: four settings and the Canvas address (design decision 18). */
import { useState } from 'preact/hooks';
import { t } from '../i18n';
import type { IsoDayOfWeek, Settings } from '../model/types';
import type { SettingsProps } from './contract';
import { hostOf, weekdayName } from './format';
import { AppMark } from './icons';
import { HostText, newId, Switch } from './parts';

/** Sunday first, as Canvas shows the week for English (US). */
const WEEK_DAYS: IsoDayOfWeek[] = [7, 1, 2, 3, 4, 5, 6];

export function parseWeekStart(value: string): Settings['weekStart'] {
  const day = Number(value);
  return WEEK_DAYS.includes(day as IsoDayOfWeek) ? (day as IsoDayOfWeek) : 'auto';
}

export function toggleHidden(hidden: string[], courseId: string, hide: boolean): string[] {
  const without = hidden.filter((id) => id !== courseId);
  return hide ? [...without, courseId] : without;
}

export function SettingsView({
  settings,
  courses,
  origin,
  onChange,
  onChangeAddress,
}: SettingsProps) {
  const [ids] = useState(() => ({
    weekStart: newId('week-start'),
    hiddenTitle: newId('hidden-title'),
    hiddenHelp: newId('hidden-help'),
    rings: newId('rings'),
    ringsName: newId('rings-name'),
    canvas: newId('canvas'),
    canvasName: newId('canvas-name'),
    canvasHelp: newId('canvas-help'),
    address: newId('address'),
  }));
  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  return (
    <div class="wr" data-surface="page">
      <main class="wr-page">
        <header class="wr-page-head">
          <AppMark size={32} />
          <h1 class="wr-page-title">{t('settingsTitle')}</h1>
        </header>

        <div class="wr-settings">
          <section class="wr-setting">
            <label class="wr-setting-name" for={ids.weekStart}>
              {t('settingWeekStart')}
            </label>
            <select
              id={ids.weekStart}
              class="wr-input"
              value={String(settings.weekStart)}
              onChange={(event) => update({ weekStart: parseWeekStart(event.currentTarget.value) })}
            >
              <option value="auto">{t('weekStartAuto')}</option>
              {WEEK_DAYS.map((day) => (
                <option key={day} value={String(day)}>
                  {weekdayName(day)}
                </option>
              ))}
            </select>
          </section>

          <section class="wr-setting" aria-labelledby={ids.hiddenTitle}>
            <div class="wr-setting-text">
              <h2 class="wr-setting-name" id={ids.hiddenTitle}>
                {t('settingHiddenCourses')}
              </h2>
              <p class="wr-setting-help" id={ids.hiddenHelp}>
                {t('hiddenCoursesHelp')}
              </p>
            </div>
            {courses.length === 0 ? (
              <p class="wr-hint">{t('noCoursesYet')}</p>
            ) : (
              <ul class="wr-course-list">
                {courses.map((course) => {
                  const id = `${ids.hiddenTitle}-${course.id}`;
                  return (
                    <li key={course.id}>
                      <label for={id}>{course.name}</label>
                      <Switch
                        id={id}
                        checked={settings.hiddenCourseIds.includes(course.id)}
                        label={t('hideCourse', course.name)}
                        onChange={(hide) =>
                          update({
                            hiddenCourseIds: toggleHidden(
                              settings.hiddenCourseIds,
                              course.id,
                              hide,
                            ),
                          })
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section class="wr-setting wr-setting-row">
            <div class="wr-setting-text">
              <label class="wr-setting-name" id={ids.ringsName} for={ids.rings}>
                {t('settingShowRings')}
              </label>
            </div>
            <Switch
              id={ids.rings}
              checked={settings.showRings}
              labelledBy={ids.ringsName}
              onChange={(showRings) => update({ showRings })}
            />
          </section>

          <section class="wr-setting wr-setting-row">
            <div class="wr-setting-text">
              <label class="wr-setting-name" id={ids.canvasName} for={ids.canvas}>
                {t('settingShowOnCanvas')}
              </label>
              <p class="wr-setting-help" id={ids.canvasHelp}>
                {t('showOnCanvasHelp')}
              </p>
            </div>
            <Switch
              id={ids.canvas}
              checked={settings.showOnCanvasPages}
              labelledBy={ids.canvasName}
              describedBy={ids.canvasHelp}
              onChange={(showOnCanvasPages) => update({ showOnCanvasPages })}
            />
          </section>

          <section class="wr-setting wr-setting-row" aria-labelledby={ids.address}>
            <div class="wr-setting-text">
              <h2 class="wr-setting-name" id={ids.address}>
                {t('settingAddress')}
              </h2>
              {origin ? (
                <HostText class="wr-address-value" host={hostOf(origin)} />
              ) : (
                <p class="wr-setting-help">{t('addressNotSet')}</p>
              )}
            </div>
            <button type="button" class="wr-btn wr-btn-small" onClick={onChangeAddress}>
              {t('changeAddress')}
            </button>
          </section>
        </div>
      </main>
    </div>
  );
}
