export type BuildBrowser = 'chrome' | 'edge' | 'firefox';

/** The repository root. */
export declare const ROOT: string;

/** Returns the build directory of a browser, such as `<root>/.output/chrome-mv3`. */
export declare function targetDir(browser: BuildBrowser): string;

/** Tells whether the build of a browser exists and is newer than every build input. */
export declare function isBuildFresh(browser: BuildBrowser): boolean;

/** Builds a browser target with `npm run build:<browser>` unless its build is fresh. Returns the build directory. */
export declare function ensureBuild(browser: BuildBrowser): string;
