import { ensureBuild } from '../../scripts/lib/ensure-build.mjs';

/** Builds .output/chrome-mv3 once before the tests, unless the build is newer than the sources. */
export default function globalSetup(): void {
  ensureBuild('chrome');
}
