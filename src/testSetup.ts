import { Storage } from "happy-dom";

/**
 * Node 22+ lazily defines non-enumerable `localStorage` / `sessionStorage`
 * accessors on `globalThis` that resolve to `undefined` unless the process was
 * started with `--localstorage-file`. vitest's `populateGlobal` only copies a
 * happy-dom key onto the global when that key is not already present, so the
 * dead Node accessor wins and every DOM-backed storage test fails with
 * "Cannot read properties of undefined (reading 'clear')".
 *
 * Re-pointing both globals at a real happy-dom `Storage` before any test runs
 * keeps `localStorage` working on Node 20 (CI), Node 22+ (local) and inside
 * Tauri, without depending on a CLI flag.
 */
for (const name of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, name, {
    value: new Storage(),
    configurable: true,
    writable: true,
  });
}
