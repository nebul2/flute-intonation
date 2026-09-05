/* The build string, on its own so anything can read it without importing the
 * app shell -- which would be a cycle, since the shell imports every view.
 * Bumped together with the copy in sw.js, whose cache key it is. */
export const VERSION = "phase 5.8 · 2026-09-05";
