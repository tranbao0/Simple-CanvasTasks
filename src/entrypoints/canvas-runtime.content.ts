import { startInpageSurface } from '@/lib/surface/inpage';

/**
 * The in-page list on a custom Canvas domain. The background registers this script at runtime
 * for the saved origin only, so it declares no matches here (decision 5).
 */
export default defineContentScript({
  registration: 'runtime',
  main(ctx) {
    void startInpageSurface(ctx);
  },
});
