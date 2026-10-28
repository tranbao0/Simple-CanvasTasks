/**
 * The side panel page. See docs/design.md, decisions 4 and 5.
 */
import { browser } from 'wxt/browser';
import { BROWSER_KIND } from '../platform/browserKind';
import { logFailure } from '../platform/log';
import { connectPanelPort } from '../platform/panelPort';
import { App } from '../ui/App';
import { installStyles } from '../ui/styles';
import { actionShortcut, extensionPageHost } from './hosts';
import { mountRuntime } from './mountRuntime';
import { createSurfaceRuntime, type SurfaceRuntime } from './runtime';

/**
 * The side panel (Chrome and Edge) or sidebar (Firefox). It holds a port tagged with its window
 * id, so the background knows the panel is open in that window. The Firefox sidebar opens at
 * install, so it also shows the first-run steps, with the browser and the shortcut.
 */
export function startPanel(root: HTMLElement): SurfaceRuntime {
  installStyles(document);
  const runtime = createSurfaceRuntime(extensionPageHost(), {
    surface: 'panel',
    scopeCourseId: null,
  });
  let shortcut: string | null = null;
  const draw = mountRuntime(root, runtime, (state) => (
    <App
      surface="panel"
      state={state}
      actions={runtime.actions}
      browser={BROWSER_KIND}
      shortcut={shortcut}
    />
  ));
  actionShortcut()
    .then((value) => {
      shortcut = value;
      draw();
    })
    .catch((error: unknown) => logFailure('shortcut', error));
  browser.windows
    .getCurrent()
    .then((win) => {
      if (win.id !== undefined) connectPanelPort(win.id);
    })
    .catch((error: unknown) => logFailure('panel port', error));
  return runtime;
}
