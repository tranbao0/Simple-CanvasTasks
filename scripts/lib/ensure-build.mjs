// Builds one browser target when its output is missing or older than its inputs.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Files and folders whose changes make a build stale. */
const BUILD_INPUTS = ['src', 'wxt.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json'];

/**
 * Returns the build directory of a browser, such as `<root>/.output/chrome-mv3`.
 * @param {'chrome' | 'edge' | 'firefox'} browser
 * @returns {string}
 */
export function targetDir(browser) {
  return path.join(ROOT, '.output', `${browser}-mv3`);
}

/**
 * Returns the newest modification time below a path, or 0 when the path does not exist.
 * @param {string} entry
 * @returns {number}
 */
function newestModification(entry) {
  if (!existsSync(entry)) return 0;
  const info = statSync(entry);
  if (!info.isDirectory()) return info.mtimeMs;
  return readdirSync(entry).reduce(
    (newest, child) => Math.max(newest, newestModification(path.join(entry, child))),
    info.mtimeMs,
  );
}

/**
 * Tells whether the build of a browser exists and is newer than every build input.
 * @param {'chrome' | 'edge' | 'firefox'} browser
 * @returns {boolean}
 */
export function isBuildFresh(browser) {
  const manifest = path.join(targetDir(browser), 'manifest.json');
  if (!existsSync(manifest)) return false;
  const builtAt = statSync(manifest).mtimeMs;
  return BUILD_INPUTS.every((input) => newestModification(path.join(ROOT, input)) <= builtAt);
}

/**
 * Builds a browser target with `npm run build:<browser>` unless its build is fresh.
 * @param {'chrome' | 'edge' | 'firefox'} browser
 * @returns {string} the build directory
 */
export function ensureBuild(browser) {
  if (!isBuildFresh(browser)) {
    console.log(`Building the ${browser} extension...`);
    execSync(`npm run build:${browser}`, { cwd: ROOT, stdio: 'inherit' });
  }
  return targetDir(browser);
}
