// Shared helpers for the scripts that check the built extension in .output/<target>.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** The build targets that WXT writes for this project. */
export const DEFAULT_TARGETS = Object.freeze(['chrome-mv3', 'edge-mv3', 'firefox-mv3']);

/**
 * Parses `[--out-dir <dir>] [target ...]`.
 * @param {readonly string[]} argv the arguments after the script name
 * @returns {{ outDir: string, targets: string[] }}
 */
export function parseArgs(argv) {
  let outDir = '.output';
  const targets = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out-dir') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--out-dir needs a directory');
      outDir = value;
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}`);
    } else {
      targets.push(arg);
    }
  }
  return {
    outDir: path.resolve(outDir),
    targets: targets.length > 0 ? targets : [...DEFAULT_TARGETS],
  };
}

/**
 * Returns the browser for a target directory name such as `firefox-mv3`.
 * @param {string} target
 * @returns {'chrome' | 'edge' | 'firefox'}
 */
export function browserOf(target) {
  const browser = target.split('-')[0];
  if (browser === 'chrome' || browser === 'edge' || browser === 'firefox') return browser;
  throw new Error(
    `Unknown build target "${target}". Expected one of ${DEFAULT_TARGETS.join(', ')}.`,
  );
}

/**
 * Lists every file below a directory as sorted POSIX paths relative to it.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
    )
    .sort();
}

/**
 * Returns the directory of a target, or throws when the target was not built.
 * @param {string} outDir
 * @param {string} target
 * @returns {Promise<string>}
 */
export async function requireTargetDir(outDir, target) {
  const dir = path.join(outDir, target);
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(
      `${path.relative(process.cwd(), dir) || dir} does not exist. Run "npm run build" first.`,
    );
  }
  return dir;
}

/**
 * Reads and parses a JSON file.
 * @param {string} file
 * @returns {Promise<unknown>}
 */
export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/**
 * Formats a byte count as kilobytes with one decimal (1 KB = 1000 bytes).
 * @param {number} bytes
 * @returns {string}
 */
export function formatKb(bytes) {
  return `${(bytes / 1000).toFixed(1)} KB`;
}

/**
 * Runs a check for each target, prints its problems, and sets the exit code.
 * @param {string} title the name of the check, for the log
 * @param {(dir: string, target: string) => Promise<string[]>} checkTarget returns the problems
 * @returns {Promise<void>}
 */
export async function runForTargets(title, checkTarget) {
  let problems = 0;
  try {
    const { outDir, targets } = parseArgs(process.argv.slice(2));
    for (const target of targets) {
      const dir = await requireTargetDir(outDir, target);
      const found = await checkTarget(dir, target);
      for (const problem of found) console.error(`  FAIL ${target}: ${problem}`);
      problems += found.length;
    }
  } catch (error) {
    console.error(`${title}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }
  if (problems > 0) {
    console.error(`${title}: ${problems} problem(s) found.`);
    process.exitCode = 1;
  } else {
    console.log(`${title}: passed.`);
  }
}
