/**
 * @gwenjs/core/testing — real WASM engine harness.
 *
 * No semver guarantee. Do not import this from production code.
 * The entry does not pull vitest into the runtime bundle.
 * `createRealEngine` reads the wasm artifacts with `node:fs`. Node and jsdom can import this file. A browser test runner cannot.
 */

export { createRealEngine } from "./testing/create-real-engine";
export type { CreateRealEngineOptions, RealEngineHandle } from "./testing/create-real-engine";
