import { createBackgroundDataOwner, wireDataTriggers } from '@/lib/data/background';
import { wireDataRouter } from '@/lib/data/router';
import { wireActionClick } from '@/lib/platform/actionClick';
import { wireRuntimeContentScriptSync } from '@/lib/platform/contentScripts';
import { wireWelcomePage } from '@/lib/platform/install';
import { createPanelRegistry } from '@/lib/platform/panelRegistry';

/**
 * Every listener is added synchronously at the top level, so the browser can wake the service
 * worker for any of these events. See docs/design.md, decisions 4, 5 and 11.
 */
export default defineBackground(() => {
  const registry = createPanelRegistry();
  wireActionClick({ registry });
  wireRuntimeContentScriptSync();
  wireWelcomePage();
  const owner = createBackgroundDataOwner();
  wireDataRouter(owner);
  wireDataTriggers(owner);
});
