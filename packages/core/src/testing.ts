/**
 * @file @gwenjs/core/testing — test helpers for @gwenjs/core
 *
 * This subpath is reserved for unit testing utilities and mocks.
 * These APIs are NOT stable across versions and should never be imported
 * in production code.
 *
 * Only import from `@gwenjs/core/testing` in test files.
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
