/**
 * @file @gwenjs/core/testing — test helpers for @gwenjs/core
 *
 * This subpath is reserved for unit testing utilities and mocks.
 * These APIs are NOT stable across versions and should never be imported
 * in production code.
 *
 * Only import from `@gwenjs/core/testing` in test files.
 * `createRealEngine` reads the wasm artifacts with `node:fs`. Node and jsdom can import this file. A browser test runner cannot.
 *
 * @example
 * ```typescript
 * // tests/my-engine.test.ts
 * import { _injectMockWasmEngine, _resetWasmBridge } from '@gwenjs/core/testing';
 *
 * describe('MyEngine', () => {
 *   afterEach(() => {
 *     _resetWasmBridge();
 *   });
 *
 *   it('works with mocked WASM', () => {
 *     const mockEngine = vi.fn();
 *     _injectMockWasmEngine(mockEngine);
 *     // ... test code
 *   });
 * });
 * ```
 */

export {
  _injectMockWasmEngine,
  _resetWasmBridge,
  _injectMockWasmExports,
} from "./engine/wasm-bridge.js";

export {
  createRealEngine,
  type CreateRealEngineOptions,
  type RealEngineHandle,
} from "./testing/create-real-engine.js";
