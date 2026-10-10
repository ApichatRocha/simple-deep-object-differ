/**
 * Public entry point for simple-deep-object-differ.
 *
 * Re-exports the diff function, the kind constants, and the default comparator so callers
 * can build higher-level tools on top without reaching into `core.js`.
 */

export { deepDiff, KIND, defaultEqual, isPlainObject, isArray } from './core.js';
