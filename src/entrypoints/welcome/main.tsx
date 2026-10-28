import { startWelcome } from '@/lib/surface/welcomePage';

const root = document.getElementById('app');
if (root !== null) startWelcome(root);
