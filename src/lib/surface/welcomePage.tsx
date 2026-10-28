/**
 * The welcome page that opens on install. See docs/design.md, decision 5, "First run".
 */
import { BROWSER_KIND } from '../platform/browserKind';
import { logFailure } from '../platform/log';
import { installStyles } from '../ui/styles';
import { WelcomeView } from '../ui/WelcomeView';
import { actionShortcut, extensionPageHost } from './hosts';
import { mountRuntime } from './mountRuntime';
import { createSurfaceRuntime, type SurfaceRuntime } from './runtime';

/** The welcome page that opens on install, with the same setup steps as the panel. */
export function startWelcome(root: HTMLElement): SurfaceRuntime {
  installStyles(document);
  const runtime = createSurfaceRuntime(extensionPageHost(), {
    surface: 'page',
    scopeCourseId: null,
  });
  let shortcut: string | null = null;
  const draw = mountRuntime(root, runtime, (state) => (
    <WelcomeView
      browser={BROWSER_KIND}
      shortcut={shortcut}
      state={state}
      actions={runtime.actions}
    />
  ));
  actionShortcut()
    .then((value) => {
      shortcut = value;
      draw();
    })
    .catch((error: unknown) => logFailure('shortcut', error));
  return runtime;
}
