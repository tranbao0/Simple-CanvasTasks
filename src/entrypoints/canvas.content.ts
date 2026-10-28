import { startInpageSurface } from '@/lib/surface/inpage';

/** The in-page list on `*.instructure.com`. It mounts only on the saved Canvas (decision 5). */
export default defineContentScript({
  matches: ['https://*.instructure.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    void startInpageSurface(ctx);
  },
});
