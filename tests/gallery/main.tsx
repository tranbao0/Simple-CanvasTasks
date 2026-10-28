/**
 * The view gallery. It renders every surface state from mock data at several widths.
 * `?theme=dark` renders the in-page surfaces with a dark host; extension pages follow
 * `prefers-color-scheme`, which the screenshot script emulates.
 * `?scene=<name>` renders one scene only.
 */
import { render, type ComponentChildren, type VNode } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import {
  App,
  APP_CSS,
  CollapsedLine,
  installStyles,
  SettingsView,
  WelcomeView,
} from '../../src/lib/ui';
import type { AppProps, SurfaceKind } from '../../src/lib/ui/contract';
import { attachShadowMount, type ShadowMount } from '../../src/lib/surface/shadowMount';
import {
  COURSES,
  currentWeekGroups,
  et,
  hiddenCourseView,
  limitedFilteredView,
  mkGroup,
  mkItem,
  mkView,
  noopActions,
  nonReadyStates,
  nothingDueView,
  ORIGIN,
  OTHER_OFFER,
  pastWeekView,
  readyState,
} from '../../src/lib/ui/testing/mocks';
import type { Settings } from '../../src/lib/model/types';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const only = params.get('scene');
const actions = noopActions((name, args) => console.info('action', name, ...args));

const PANEL_WIDTHS = [170, 240, 360, 480];

interface Scene {
  name: string;
  widths: number[];
  /** Fixed frame height, so sticky parts show as in a real panel. */
  height?: number;
  /** In-page scenes render inside a shadow root with a themed host. */
  shadow?: boolean;
  render(): VNode;
  /** Runs after the first render, such as clicks that open groups. */
  setup?(root: ParentNode): Promise<void>;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function clickAll(root: ParentNode, selector: string): Promise<void> {
  for (let pass = 0; pass < 4; pass += 1) {
    const targets = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (targets.length === 0) return;
    targets.forEach((el) => el.click());
    await tick();
  }
}

function app(
  surface: SurfaceKind,
  state: AppProps['state'],
  options: Pick<AppProps, 'collapsedToPanel' | 'browser' | 'shortcut'> = {},
) {
  return () => <App surface={surface} state={state} actions={actions} {...options} />;
}

/** A busy week for the in-page list: groups longer than its row limit. */
function busyWeekView() {
  const base = currentWeekGroups();
  const pastDue = base.find((group) => group.kind === 'past_due');
  const extraPastDue = ['Lab 6 prelab questions', 'Reading notes: chapter 8'].map((title, index) =>
    mkItem({
      title,
      course: index === 0 ? 'bio' : 'hist',
      due: et('2026-10-24', '09:00'),
      canSkip: true,
    }),
  );
  const today = mkGroup({
    kind: 'today',
    date: '2026-10-27',
    items: [
      ['Quiz 7: Integration by parts', 'math', '09:00'],
      ['Lab 6: Thin-layer chromatography', 'chem', '13:00'],
      ['Discussion: Columbian exchange', 'hist', '17:00'],
      ['Essay draft 2', 'engl', '20:00'],
      ['Problem Set 7', 'math', '23:59'],
      ['Reading quiz 9', 'bio', '23:59'],
    ].map(([title, course, time]) =>
      mkItem({
        title: title ?? '',
        course: course as 'math' | 'chem' | 'hist' | 'engl' | 'bio',
        due: et('2026-10-27', time ?? '23:59'),
      }),
    ),
  });
  return mkView({
    groups: base.flatMap((group) => {
      if (group.kind === 'past_due')
        return [{ ...group, items: [...(pastDue?.items ?? []), ...extraPastDue] }];
      if (group.kind === 'today') return [today];
      return [group];
    }),
  });
}

const settings: Settings = {
  weekStart: 'auto',
  hiddenCourseIds: [COURSES.psyc.id],
  showRings: true,
  showOnCanvasPages: true,
};

const scenes: Scene[] = [
  { name: 'ready', widths: PANEL_WIDTHS, render: app('panel', readyState()) },
  {
    name: 'ready-expanded',
    widths: PANEL_WIDTHS,
    render: app('panel', readyState()),
    async setup(root) {
      await clickAll(root, '[aria-expanded="false"]:not(.wr-chip):not(.wr-marker)');
      const tip = root.querySelectorAll<HTMLElement>('button.wr-chip');
      tip.forEach((el, index) => {
        if (index % 4 === 0) el.click();
      });
      await tick();
    },
  },
  {
    name: 'ready-notices',
    widths: PANEL_WIDTHS,
    render: app(
      'panel',
      readyState({
        stale: { since: '2026-10-27T19:05:00Z', offline: true },
        refreshing: true,
        offer: { origin: 'https://canvas.state.edu', mode: 'switch' },
        undo: { kind: 'done', count: 1 },
        seenNotes: { firstDone: false, firstSkip: false },
      }),
    ),
    async setup(root) {
      root.querySelector<HTMLElement>('.wr-check-input:not(:checked):not(:disabled)')?.click();
      root.querySelector<HTMLElement>('[data-part="skip"]')?.click();
      await tick();
    },
  },
  {
    name: 'ready-viewport',
    widths: [240, 360],
    height: 560,
    render: app('panel', readyState({ undo: { kind: 'skipped_all', count: 3 } })),
  },
  {
    name: 'ready-past-week',
    widths: PANEL_WIDTHS,
    render: app('panel', readyState({ view: pastWeekView() })),
  },
  {
    name: 'ready-nothing-due',
    widths: PANEL_WIDTHS,
    render: app('panel', readyState({ view: nothingDueView() })),
  },
  {
    name: 'ready-limited-filter',
    widths: PANEL_WIDTHS,
    render: app(
      'panel',
      readyState({ view: limitedFilteredView(), undo: { kind: 'deleted', count: 1 } }),
    ),
  },
  {
    // Canvas course codes can be long; they wrap to two lines under the ring.
    name: 'ready-long-codes',
    widths: [170, 240],
    render: app(
      'panel',
      readyState({
        view: mkView({
          rings: mkView().rings.map((ring) => {
            if (ring.courseId === COURSES.bio.id)
              return { ...ring, shortLabel: 'FA26-BIOL-1010-001' };
            if (ring.courseId === COURSES.chem.id) return { ...ring, shortLabel: 'CHEM 210 L02' };
            return ring;
          }),
        }),
      }),
    ),
  },
  {
    name: 'ready-skipped-courses',
    widths: PANEL_WIDTHS,
    render: app(
      'panel',
      readyState({
        skippedCourses: [
          { id: COURSES.bio.id, name: 'BIO 201' },
          { id: COURSES.chem.id, name: 'CHEM 210' },
        ],
      }),
    ),
  },
  {
    name: 'ready-skipped-stale',
    widths: [240, 360],
    render: app(
      'panel',
      readyState({
        skippedCourses: [{ id: COURSES.bio.id, name: 'BIO 201' }],
        stale: { since: '2026-10-27T19:05:00Z', offline: false },
      }),
    ),
  },
  {
    name: 'ready-filter-no-rings',
    widths: [240, 360],
    render: app(
      'panel',
      readyState({ view: mkView({ rings: [], courseFilter: COURSES.math.id }) }),
    ),
  },
  {
    name: 'ready-no-rings',
    widths: [240, 360],
    render: app(
      'panel',
      readyState({
        view: mkView({ rings: [], hiddenCourseCount: 0, browserTimeZoneDiffers: false }),
      }),
    ),
  },
  {
    name: 'form-new',
    widths: PANEL_WIDTHS,
    render: app('panel', readyState()),
    async setup(root) {
      root.querySelector<HTMLElement>('.wr-add')?.click();
      await tick();
    },
  },
  {
    name: 'form-edit-error',
    widths: PANEL_WIDTHS,
    render: app('panel', readyState()),
    async setup(root) {
      root.querySelector<HTMLElement>('button.wr-title')?.click();
      await tick();
      const title = root.querySelector<HTMLInputElement>('input[type="text"]');
      if (title) {
        title.value = '';
        title.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await tick();
      root.querySelector<HTMLElement>('button[type="submit"]')?.click();
      await tick();
    },
  },
  ...nonReadyStates().map((entry): Scene => ({
    name: `state-${entry.name}`,
    widths: PANEL_WIDTHS,
    render: app('panel', entry.state),
  })),
  {
    name: 'state-address-error',
    widths: [170, 360],
    render: app('panel', { kind: 'not_set_up', offer: null, savedOrigin: null }),
    async setup(root) {
      root.querySelector<HTMLElement>('button[type="submit"]')?.click();
      await tick();
    },
  },
  {
    name: 'state-firefox-first-run',
    widths: PANEL_WIDTHS,
    render: app(
      'panel',
      { kind: 'not_set_up', offer: null, savedOrigin: null },
      { browser: 'firefox', shortcut: 'Ctrl+Alt+W' },
    ),
  },
  {
    name: 'state-firefox-first-run-offer',
    widths: [240, 360],
    render: app(
      'panel',
      { kind: 'not_set_up', offer: { origin: ORIGIN, mode: 'use' }, savedOrigin: null },
      { browser: 'firefox', shortcut: null },
    ),
  },
  {
    name: 'state-cant-load-offer',
    widths: [240, 360],
    render: app('panel', {
      kind: 'cant_load',
      origin: ORIGIN,
      offline: false,
      savedOrigin: null,
      offer: OTHER_OFFER,
    }),
  },
  {
    name: 'ready-note',
    widths: PANEL_WIDTHS,
    render: app('panel', readyState({ seenNotes: { firstDone: false, firstSkip: true } })),
    async setup(root) {
      root.querySelector<HTMLElement>('.wr-check-input:not(:checked):not(:disabled)')?.click();
      await tick();
    },
  },
  {
    name: 'ready-undo',
    widths: PANEL_WIDTHS,
    height: 520,
    render: app('panel', readyState({ undo: { kind: 'deleted', count: 1 } })),
  },
  { name: 'inpage-ready', widths: [240], shadow: true, render: app('inpage', readyState()) },
  {
    name: 'inpage-four',
    widths: [240],
    shadow: true,
    render: app(
      'inpage',
      readyState({
        view: mkView({
          groups: [
            mkGroup({
              kind: 'today',
              date: '2026-10-27',
              items: ['Debate 2', 'Participation: Week 9', 'Quiz 3', 'Return library books'].map(
                (title) => mkItem({ title, course: 'hist', due: et('2026-10-27', '23:59') }),
              ),
            }),
          ],
        }),
        offer: OTHER_OFFER,
        undo: { kind: 'done', count: 1 },
      }),
    ),
  },
  {
    name: 'inpage-busy',
    widths: [240],
    shadow: true,
    render: app('inpage', readyState({ view: busyWeekView() })),
  },
  {
    name: 'inpage-busy-expanded',
    widths: [240],
    shadow: true,
    render: app('inpage', readyState({ view: busyWeekView() })),
    async setup(root) {
      root.querySelector<HTMLElement>('.wr-more')?.click();
      await tick();
    },
  },
  {
    name: 'inpage-course-home',
    widths: [240],
    shadow: true,
    render: app(
      'inpage',
      readyState({
        view: mkView({
          ...limitedFilteredView(),
          limited: false,
          courseFilter: undefined,
          scopeCourseId: COURSES.math.id,
          hourCycle: 'h12',
          hiddenCourseCount: 0,
          rings: mkView().rings.filter((r) => r.courseId === COURSES.math.id),
        }),
      }),
    ),
  },
  {
    name: 'inpage-loading',
    widths: [240],
    shadow: true,
    render: app('inpage', { kind: 'loading' }),
  },
  { name: 'inpage-collapsed', widths: [240], shadow: true, render: () => <CollapsedLine /> },
  {
    name: 'inpage-hidden-course',
    widths: [240],
    shadow: true,
    render: app('inpage', readyState({ view: hiddenCourseView() })),
  },
  {
    name: 'inpage-signed-out',
    widths: [240],
    shadow: true,
    render: app('inpage', { kind: 'signed_out', origin: ORIGIN, isFirefox: false, offer: null }),
  },
  {
    name: 'settings',
    widths: [360, 640],
    render: () => (
      <SettingsView
        settings={settings}
        courses={Object.values(COURSES).map(({ id, name }) => ({ id, name }))}
        origin={ORIGIN}
        onChange={(next) => console.info('settings', next)}
        onChangeAddress={() => actions.changeAddress()}
      />
    ),
  },
  {
    name: 'welcome-chrome',
    widths: [360, 720],
    render: () => (
      <WelcomeView
        browser="chrome"
        shortcut="Alt+Shift+W"
        state={{ kind: 'not_set_up', offer: null, savedOrigin: null }}
        actions={actions}
      />
    ),
  },
  {
    name: 'welcome-edge-ready',
    widths: [720],
    render: () => (
      <WelcomeView browser="edge" shortcut={null} state={readyState()} actions={actions} />
    ),
  },
];

/** Renders `children` into the same shadow mount that the in-page content script uses. */
function ShadowFrame(props: { children: ComponentChildren; width: number }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<ShadowMount | null>(null);
  useLayoutEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    mountRef.current ??= attachShadowMount(parent, { css: APP_CSS, theme });
    render(<>{props.children}</>, mountRef.current.root);
  });
  return <div ref={parentRef} class="frame-host" style={{ width: `${props.width}px` }} />;
}

function SceneView({ scene }: { scene: Scene }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const section = ref.current;
    if (!section) return;
    const roots: ParentNode[] = [];
    section.querySelectorAll<HTMLElement>('.frame').forEach((frame) => {
      const host = frame.querySelector<HTMLElement>('weekrow-list');
      roots.push(host?.shadowRoot ?? frame);
    });
    const run = scene.setup
      ? Promise.all(roots.map((root) => scene.setup?.(root)))
      : Promise.resolve();
    void run.then(() => section.setAttribute('data-done', ''));
  }, [scene]);
  return (
    <section ref={ref} class="scene" data-scene={scene.name}>
      <h2 class="scene-name">{scene.name}</h2>
      <div class="frames">
        {scene.widths.map((width) => (
          <div key={width} class="frame-wrap">
            <div class="frame-label">{width} px</div>
            <div
              class={scene.height ? 'frame is-fixed' : 'frame'}
              style={{
                width: `${width}px`,
                height: scene.height ? `${scene.height}px` : undefined,
              }}
            >
              {scene.shadow ? (
                <ShadowFrame width={width}>{scene.render()}</ShadowFrame>
              ) : (
                scene.render()
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const GALLERY_CSS = `
  body { margin: 0; padding: 24px; font: 13px system-ui, sans-serif; background: light-dark(#e9ebef, #0d0e10); color: light-dark(#333, #ccc); color-scheme: light dark; }
  .scene { margin: 0 0 40px; padding: 16px; width: max-content; background: light-dark(#dfe2e7, #050607); border-radius: 12px; }
  .scene-name { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
  .frames { display: flex; align-items: flex-start; gap: 24px; }
  .frame-label { margin-bottom: 6px; font-size: 11px; opacity: .7; }
  .frame { box-shadow: 0 0 0 1px light-dark(#c8ccd3, #2a2d33); background: light-dark(#fff, #17181b); }
  .frame.is-fixed { overflow: auto; }
  .frame > .wr[data-surface='panel'] { min-height: 0; }
  .frame:not(.is-fixed) .wr-header, .frame:not(.is-fixed) .wr-dock { position: relative; }
  .frame.is-fixed > .wr[data-surface='panel'] { min-height: 100%; }
  .frame:has(weekrow-list[data-theme='dark']) { background: #1b1c1f; }
  .frame:has(weekrow-list[data-theme='light']) { background: #fff; }
`;

function Gallery() {
  const shown = only ? scenes.filter((scene) => scene.name === only) : scenes;
  return (
    <>
      <style>{GALLERY_CSS}</style>
      {shown.map((scene) => (
        <SceneView key={scene.name} scene={scene} />
      ))}
    </>
  );
}

installStyles(document);
const root = document.getElementById('gallery');
if (root) render(<Gallery />, root);
