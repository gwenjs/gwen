/**
 * @file Testing utilities for renderer plugin authors.
 *
 * Import from `@gwenjs/renderer-core/testing` in your test suite.
 *
 * @example
 * ```ts
 * import { runConformanceTests } from '@gwenjs/renderer-core/testing'
 * import { MyRendererPlugin } from '../src'
 *
 * describe('MyRendererPlugin conformance', () => {
 *   it('satisfies the RendererService contract', () => {
 *     runConformanceTests(MyRendererPlugin({ layers: { main: { order: 0 } } }))
 *   })
 * })
 * ```
 */
export { runConformanceTests } from "./conformance-suite.js";
