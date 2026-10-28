/** One item in the list: check box, title, course, time, chips and actions. */
import { useState } from 'preact/hooks';
import type { TargetedMouseEvent } from 'preact';
import { t } from '../i18n';
import type { ItemView, WeekView } from '../model/types';
import { formatDateTime, formatTime } from './format';
import { AlertIcon, CheckIcon, ClockIcon, InfoIcon, LockIcon } from './icons';
import { newId } from './parts';
import { itemTags, type Tag } from './tags';

/** How the due time shows: the time only, the date and time, or nothing. */
export type WhenMode = 'time' | 'datetime' | 'none';

export interface ItemHandlers {
  onToggleDone(item: ItemView, done: boolean): void;
  onSkip(item: ItemView): void;
  onUnskip(item: ItemView): void;
  onMoveToToday(item: ItemView): void;
  onOpen(item: ItemView): void;
  onEditNote(item: ItemView): void;
}

interface ItemRowProps {
  item: ItemView;
  view: WeekView;
  when: WhenMode;
  handlers: ItemHandlers;
}

/** The course name of an item, or the "Personal" text for an item with no course. */
export function courseLabel(item: ItemView): string {
  return item.courseId === null ? t('personal') : item.contextLabel;
}

export function whenText(item: ItemView, view: WeekView, when: WhenMode): string | null {
  if (item.due === null || when === 'none') return null;
  if (when === 'datetime' || item.isLookAhead)
    return formatDateTime(item.due, view.timeZone, view.hourCycle);
  return formatTime(item.due, view.timeZone, view.hourCycle);
}

/**
 * The line under the title that says which part of the work the row is: a discussion checkpoint,
 * or a peer review, whose title is the title of the assignment the student reviews.
 */
export function subtitleText(item: Pick<ItemView, 'kind' | 'subtitleTag'>): string | null {
  if (item.kind === 'peer_review') return t('peerReviewSubtitle');
  switch (item.subtitleTag) {
    case 'reply_to_topic':
      return t('checkpointReplyToTopic');
    case 'reply_to_entry':
      return t('checkpointReplyToEntry');
    default:
      return null;
  }
}

function isPlainLeftClick(event: TargetedMouseEvent<HTMLElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function TagIcon({ icon }: { icon: Tag['icon'] }) {
  switch (icon) {
    case 'lock':
      return <LockIcon />;
    case 'clock':
      return <ClockIcon />;
    case 'alert':
      return <AlertIcon />;
    case null:
      return null;
  }
}

function TagView(props: { tag: Tag; tipId: string; open: boolean; onToggle(): void }) {
  const { tag } = props;
  const className = [
    tag.shape === 'chip' ? 'wr-chip' : 'wr-marker',
    tag.tone === 'missing' ? 'wr-chip-missing' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      <TagIcon icon={tag.icon} />
      <span>{tag.label}</span>
    </>
  );
  if (tag.tip === null) return <span class={className}>{content}</span>;
  return (
    <button
      type="button"
      class={className}
      aria-expanded={props.open}
      aria-controls={props.open ? props.tipId : undefined}
      title={tag.tip}
      onClick={props.onToggle}
    >
      {content}
      {tag.shape === 'chip' && (
        <span class="wr-tip-mark">
          <InfoIcon size={12} />
        </span>
      )}
    </button>
  );
}

export function ItemRow({ item, view, when, handlers }: ItemRowProps) {
  const [ids] = useState(() => ({ tip: newId('tip'), redo: newId('redo') }));
  const [openTip, setOpenTip] = useState<string | null>(null);
  const tags = itemTags(item, view.timeZone);
  const shownTip = tags.find((tag) => tag.id === openTip && tag.tip !== null) ?? null;
  const done = item.state === 'done';
  const whenLabel = whenText(item, view, when);
  const subtitle = subtitleText(item);
  const isNote = item.kind === 'note';
  // In a view of one course, such as a course home page, every row is that course.
  const showCourse = view.scopeCourseId === null;
  const hasMeta = showCourse || subtitle !== null || whenLabel !== null;

  const onTitleClick = (event: TargetedMouseEvent<HTMLElement>) => {
    if (isNote) {
      handlers.onEditNote(item);
      return;
    }
    if (item.url !== null && !isPlainLeftClick(event)) return;
    event.preventDefault();
    handlers.onOpen(item);
  };

  const rowClass = ['wr-item', done ? 'is-done' : '', item.state === 'skipped' ? 'is-skipped' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li class={rowClass} data-row-key={item.key}>
      <span class="wr-check" title={item.checkboxDisabled ? t('redoTip') : undefined}>
        <input
          type="checkbox"
          class="wr-check-input"
          data-part="check"
          checked={done}
          disabled={item.checkboxDisabled}
          aria-label={t('doneCheckbox', item.title)}
          aria-describedby={item.checkboxDisabled ? ids.redo : undefined}
          onChange={(event) => {
            // The box shows the state from props; the runtime updates it.
            event.currentTarget.checked = done;
            handlers.onToggleDone(item, !done);
          }}
        />
        <span class="wr-check-box" aria-hidden="true">
          <CheckIcon size={12} />
        </span>
        {item.checkboxDisabled && (
          <span id={ids.redo} class="wr-sr">
            {t('redoTip')}
          </span>
        )}
      </span>

      <div class="wr-item-body">
        {isNote || item.url === null ? (
          <button
            type="button"
            class="wr-title"
            data-part="title"
            aria-label={isNote ? t('editTaskItem', item.title) : undefined}
            onClick={onTitleClick}
          >
            {item.title}
          </button>
        ) : (
          <a
            class="wr-title"
            data-part="title"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onTitleClick}
          >
            {item.title}
          </a>
        )}
        {hasMeta && (
          <div class="wr-meta">
            <div class="wr-meta-line">
              {showCourse && (
                <span class="wr-course" style={{ '--wr-course': item.color }}>
                  <span class="wr-dot" aria-hidden="true" />
                  <span class="wr-course-name">{courseLabel(item)}</span>
                </span>
              )}
              {subtitle && <span class="wr-subtitle">{subtitle}</span>}
              {whenLabel && <span class="wr-when">{whenLabel}</span>}
            </div>
          </div>
        )}
      </div>

      {(tags.length > 0 || hasActions(item)) && (
        <div class="wr-item-tags">
          {tags.map((tag) => (
            <TagView
              key={tag.id}
              tag={tag}
              tipId={ids.tip}
              open={openTip === tag.id}
              onToggle={() => setOpenTip(openTip === tag.id ? null : tag.id)}
            />
          ))}
          <ItemActions item={item} handlers={handlers} />
        </div>
      )}
      {shownTip && (
        <p id={ids.tip} class="wr-item-tip">
          {shownTip.tip}
        </p>
      )}
    </li>
  );
}

function hasActions(item: ItemView): boolean {
  return (
    (item.state === 'open' && item.canSkip) ||
    item.state === 'skipped' ||
    (item.canMoveToToday && item.noteId !== null)
  );
}

function ItemActions({ item, handlers }: { item: ItemView; handlers: ItemHandlers }) {
  const buttons = [];
  if (item.state === 'open' && item.canSkip) {
    buttons.push(
      <button
        key="skip"
        type="button"
        class="wr-quiet-btn"
        data-part="skip"
        aria-label={t('skipItem', item.title)}
        onClick={() => handlers.onSkip(item)}
      >
        {t('skip')}
      </button>,
    );
  }
  if (item.state === 'skipped') {
    buttons.push(
      <button
        key="unskip"
        type="button"
        class="wr-quiet-btn"
        data-part="unskip"
        aria-label={t('unskipItem', item.title)}
        onClick={() => handlers.onUnskip(item)}
      >
        {t('unskip')}
      </button>,
    );
  }
  if (item.canMoveToToday && item.noteId !== null) {
    buttons.push(
      <button
        key="move"
        type="button"
        class="wr-quiet-btn"
        data-part="move"
        aria-label={t('moveItemToToday', item.title)}
        onClick={() => handlers.onMoveToToday(item)}
      >
        {t('moveToToday')}
      </button>,
    );
  }
  if (buttons.length === 0) return null;
  return <div class="wr-item-actions">{buttons}</div>;
}
