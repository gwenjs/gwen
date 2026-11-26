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
export { runConformanceTests, runSurfaceConformance } from "./conformance-suite.js";
export type { SurfaceConformanceOptions } from "./conformance-suite.js";
export { runSurfacePluginConformance } from "./surface-plugin-conformance.js";
export type { SurfacePluginConformanceOptions } from "./surface-plugin-conformance.js";
export { runCameraProviderConformance } from "./camera-provider-conformance.js";
export type { CameraProviderConformanceOptions } from "./camera-provider-conformance.js";
export { MockSizeProvider } from "./mock-size-provider.js";
export type { MockSizeProviderHandle } from "./mock-size-provider.js";
