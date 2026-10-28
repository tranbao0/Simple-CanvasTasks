import { logFailure } from '@/lib/platform/log';
import { startOptions } from '@/lib/surface/optionsPage';

const root = document.getElementById('app');
if (root !== null) startOptions(root).catch((error: unknown) => logFailure('settings page', error));
