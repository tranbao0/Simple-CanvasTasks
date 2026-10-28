/** The list surface for the side panel and the Canvas page. It renders props and calls actions. */
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import type { ItemView, SurfaceState } from '../model/types';
import type { Actions, AppProps, SurfaceKind } from './contract';
import { Header } from './Header';
import { AppMark } from './icons';
import {
  Dock,
  FilterLine,
  HiddenCoursesLine,
  isUndoShortcut,
  LimitedLine,
  OfferBanner,
  OneTimeNotes,
  SkippedCoursesLine,
  StaleLine,
  type OneTimeNote,
} from './Notices';
import { Bar, newId, type HeadingLevel } from './parts';
import { Rings } from './Rings';
import { StateBody } from './States';
import { TaskForm, type TaskFormMode } from './TaskForm';
import { INPAGE_ROW_LIMIT, WeekList, type ListHandlers } from './WeekList';
import { captureFocus, firstRowControl, restoreFocus, usable, type FocusSnapshot } from './focus';

type ReadyState = Extract<SurfaceState, { kind: 'ready' }>;

/** The panel is its own page, so its top heading is level 1. In a Canvas page it is level 2. */
function baseLevel(surface: SurfaceKind): HeadingLevel {
  return surface === 'panel' ? 1 : 2;
}

function subLevel(level: HeadingLevel): HeadingLevel {
  return level === 1 ? 2 : level === 2 ? 3 : 4;
}

export function App(props: AppProps) {
  const { surface, state, actions, collapsedToPanel } = props;
  // The note wins over the collapsed line: the side panel does not show a hidden course either.
  if (state.kind === 'ready' && state.view.scopeCourseHidden) {
    return <HiddenCourseNote surface={surface} onOpenSettings={() => actions.openSettings()} />;
  }
  if (surface === 'inpage' && collapsedToPanel) return <CollapsedLine />;
  switch (state.kind) {
    case 'ready':
      return <ReadyView surface={surface} state={state} actions={actions} />;
    case 'loading':
      return <LoadingView surface={surface} actions={actions} />;
    case 'not_set_up':
    case 'checking':
    case 'no_access':
    case 'redirects':
    case 'not_canvas':
    case 'unreachable':
    case 'signed_out':
    case 'no_courses':
    case 'cant_load': {
      const browser = props.browser ?? 'chrome';
      // The Firefox sidebar opens at install, in place of the welcome page (design decision 5).
      const firstRun =
        surface === 'panel' && browser === 'firefox'
          ? { browser, shortcut: props.shortcut ?? null }
          : null;
      return (
        <div class="wr" data-surface={surface}>
          <Bar level={baseLevel(surface)} onSettings={() => actions.openSettings()} />
          <StateBody
            state={state}
            actions={actions}
            level={subLevel(baseLevel(surface))}
            context="surface"
            showOffer={surface === 'panel'}
            firstRun={firstRun}
          />
        </div>
      );
    }
  }
}

/** The in-page list while the side panel is open in the same window. */
export function CollapsedLine() {
  return (
    <div class="wr" data-surface="inpage">
      <p class="wr-collapsed">
        <AppMark size={18} />
        <span>{t('shownInPanel')}</span>
      </p>
    </div>
  );
}

/**
 * The one-line note on the home page of a course the student hid (design decision 4), with a link
 * to the settings. `App` shows it when `view.scopeCourseHidden` is set.
 */
export function HiddenCourseNote(props: { onOpenSettings(): void; surface?: SurfaceKind }) {
  return (
    <div class="wr" data-surface={props.surface ?? 'inpage'}>
      <p class="wr-collapsed">
        <AppMark size={18} />
        <span class="wr-notice-text">{t('hiddenCourseHere')}</span>
        <button type="button" class="wr-link-btn" onClick={props.onOpenSettings}>
          {t('settings')}
        </button>
      </p>
    </div>
  );
}

function LoadingView(props: { surface: SurfaceKind; actions: Actions }) {
  const level = baseLevel(props.surface);
  return (
    <div class="wr" data-surface={props.surface} aria-busy="true">
      <Header
        view={null}
        level={level}
        refreshing={false}
        addDisabledReason={null}
        onWeek={() => undefined}
        onAdd={() => undefined}
        onSettings={() => props.actions.openSettings()}
      />
      <div class="wr-rings-wrap" aria-hidden="true">
        <div class="wr-rings">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} class="wr-skel-ring-cell">
              <span class="wr-skel wr-skel-ring" />
              <span class="wr-skel wr-skel-ring-label" />
            </div>
          ))}
        </div>
      </div>
      <div class="wr-list" aria-hidden="true">
        <div class="wr-group">
          <div class="wr-group-head">
            <span class="wr-skel wr-skel-head" />
          </div>
          <ul class="wr-items">
            {[78, 62, 86, 54].map((width) => (
              <li key={width} class="wr-item">
                <span class="wr-check">
                  <span class="wr-skel wr-skel-check" />
                </span>
                <div class="wr-item-body">
                  <span class="wr-skel wr-skel-title" style={{ width: `${width}%` }} />
                  <span class="wr-skel wr-skel-meta" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p class="wr-sr" role="status">
        {t('loading')}
      </p>
    </div>
  );
}

/**
 * Ctrl+Z (Cmd+Z on a Mac) undoes while the Undo notice shows (design decision 6). The key works
 * anywhere in the surface root, the panel document or the in-page shadow root, but never in a
 * text field. The listener is in place as soon as the notice is on screen, so a fast key press
 * right after the action is not lost.
 */
function useUndoShortcut(
  rootRef: RefObject<HTMLDivElement | null>,
  active: boolean,
  onUndo: () => void,
): void {
  const latest = useRef(onUndo);
  latest.current = onUndo;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!active || !root) return;
    const scope = root.getRootNode() as Document | ShadowRoot;
    const onKeyDown = (event: Event) => {
      if (!isUndoShortcut(event as KeyboardEvent)) return;
      event.preventDefault();
      latest.current();
    };
    scope.addEventListener('keydown', onKeyDown);
    return () => scope.removeEventListener('keydown', onKeyDown);
  }, [rootRef, active]);
}

/**
 * Keeps `--wr-inset-top` and `--wr-inset-bottom` on the root at the heights of the sticky header
 * (side panel only) and the sticky dock. The stylesheet turns them into scroll margins, so a
 * focused control never hides under either (WCAG 2.4.11).
 */
function useStickyInsets(
  rootRef: RefObject<HTMLDivElement | null>,
  surface: SurfaceKind,
  enabled: boolean,
): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    const header = surface === 'panel' ? root.querySelector<HTMLElement>('.wr-header') : null;
    const dock = root.querySelector<HTMLElement>('.wr-dock');
    const update = () => {
      root.style.setProperty('--wr-inset-top', `${header?.offsetHeight ?? 0}px`);
      root.style.setProperty('--wr-inset-bottom', `${dock?.offsetHeight ?? 0}px`);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    for (const element of [header, dock]) if (element) observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--wr-inset-top');
      root.style.removeProperty('--wr-inset-bottom');
    };
  }, [rootRef, surface, enabled]);
}

function ReadyView(props: { surface: SurfaceKind; state: ReadyState; actions: Actions }) {
  const { surface, state, actions } = props;
  const { view } = state;
  const level = baseLevel(surface);
  const [form, setForm] = useState<TaskFormMode | null>(null);
  const [notes, setNotes] = useState<OneTimeNote[]>([]);
  const [limitedId] = useState(() => newId('limited'));
  const rootRef = useRef<HTMLDivElement>(null);
  /** Where focus goes when the form closes. The list is re-created, so this is a selector. */
  const returnFocus = useRef<string | null>(null);
  /** The last focused control outside the Undo notice. Focus goes back there when it closes. */
  const lastFocus = useRef<HTMLElement | null>(null);

  // Reading focus during render is safe: it only records which control had focus before this update.
  const snapshot = useRef<FocusSnapshot | null>(null);
  snapshot.current = captureFocus(rootRef.current);
  useLayoutEffect(() => {
    const root = rootRef.current;
    restoreFocus(root, snapshot.current, () =>
      root === null
        ? null
        : (usable(root, lastFocus.current) ??
          root.querySelector<HTMLElement>('.wr-add') ??
          firstRowControl(root)),
    );
    if (returnFocus.current !== null && form === null) {
      root?.querySelector<HTMLElement>(returnFocus.current)?.focus();
      returnFocus.current = null;
    }
  });

  useUndoShortcut(rootRef, form === null && state.undo !== null, () => actions.undo());
  useStickyInsets(rootRef, surface, form === null);

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && !target.closest('.wr-dock')) lastFocus.current = target;
  };

  const showNote = (note: OneTimeNote) => {
    if (state.seenNotes[note]) return;
    setNotes((current) => (current.includes(note) ? current : [...current, note]));
  };

  const openForm = (mode: TaskFormMode) => setForm(mode);

  /** Closes the form and focuses the control that opened it, or the Add button. */
  const closeForm = (focusKey: string | null) => {
    returnFocus.current = focusKey
      ? `[data-row-key="${focusKey.replace(/["\\]/g, '\\$&')}"] [data-part="title"]`
      : '.wr-add';
    setForm(null);
  };

  const handlers: ListHandlers = {
    onToggleDone(item, done) {
      actions.setDone(item.key, done);
      if (done) showNote('firstDone');
    },
    onSkip(item) {
      actions.skip(item.key);
      showNote('firstSkip');
    },
    onUnskip(item) {
      actions.unskip(item.key);
    },
    onMoveToToday(item) {
      if (item.noteId !== null) actions.moveTaskToToday(item.noteId);
    },
    onOpen(item) {
      actions.openItem(item.key);
    },
    onEditNote(item: ItemView) {
      openForm({ kind: 'edit', item });
    },
    onSkipAllOlder() {
      actions.skipAllOlder();
      showNote('firstSkip');
    },
  };

  const visibleNotes = notes.filter((note) => !state.seenNotes[note]);

  if (form !== null) {
    return (
      <div class="wr" data-surface={surface} ref={rootRef} onFocusIn={onFocusIn}>
        <TaskForm
          mode={form}
          view={view}
          courses={state.taskCourses}
          level={level}
          onSubmit={(input) => {
            if (form.kind === 'edit' && form.item.noteId !== null)
              actions.updateTask(form.item.noteId, input);
            else actions.createTask(input);
            closeForm(form.kind === 'edit' ? form.item.key : null);
          }}
          onDelete={(noteId) => {
            actions.deleteTask(noteId);
            closeForm(null);
          }}
          onCancel={() => closeForm(form.kind === 'edit' ? form.item.key : null)}
        />
      </div>
    );
  }

  return (
    <div class="wr" data-surface={surface} ref={rootRef} onFocusIn={onFocusIn}>
      <Header
        view={view}
        level={level}
        refreshing={state.refreshing}
        addDisabledReason={view.limited ? t('limitedLine') : null}
        addDescribedBy={limitedId}
        onWeek={(offset) => actions.goToWeek(offset)}
        onAdd={() => openForm({ kind: 'new' })}
        onSettings={() => actions.openSettings()}
      />
      <div class="wr-notices">
        {/* The offer is for the side panel only (design decision 4). */}
        {surface === 'panel' && state.offer && (
          <OfferBanner
            offer={state.offer}
            onAccept={(origin) => actions.acceptOffer(origin)}
            onDismiss={() => actions.dismissOffer()}
          />
        )}
        {state.stale && (
          <StaleLine
            since={state.stale.since}
            offline={state.stale.offline}
            view={view}
            onRetry={() => actions.retry()}
          />
        )}
        <SkippedCoursesLine
          courses={state.skippedCourses}
          showRetry={state.stale === null}
          onRetry={() => actions.retry()}
        />
        {view.limited && <LimitedLine id={limitedId} />}
      </div>
      <OneTimeNotes
        notes={visibleNotes}
        onSeen={(note) => {
          actions.markNoteSeen(note);
          setNotes((current) => current.filter((n) => n !== note));
        }}
      />
      <Rings
        rings={view.rings}
        filter={view.courseFilter}
        onSelect={(id) => actions.setCourseFilter(id)}
      />
      <FilterLine
        view={view}
        courses={state.taskCourses}
        onClear={() => actions.setCourseFilter(undefined)}
      />
      <div aria-busy={state.refreshing}>
        <WeekList
          view={view}
          level={subLevel(level)}
          handlers={handlers}
          rowLimit={surface === 'inpage' ? INPAGE_ROW_LIMIT : null}
        />
      </div>
      <HiddenCoursesLine count={view.hiddenCourseCount} onSettings={() => actions.openSettings()} />
      <Dock undo={state.undo} onUndo={() => actions.undo()} onClose={() => actions.dismissUndo()} />
    </div>
  );
}
