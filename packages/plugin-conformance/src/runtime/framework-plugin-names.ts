/**
 * Names of plugins built by public factories.
 * Members: `CameraCorePlugin` (`packages/camera-core/src/camera-core-plugin.ts:56`),
 * the viewports plugin (`packages/app/src/viewports-plugin.ts:35`), the screen
 * plugin (`packages/renderer-core/src/screen-plugin.ts:55`), and the scene plugin
 * `createRealEngine({ scenes: true })` installs
 * (`packages/core/src/testing/create-real-engine.ts:93`,
 * `packages/core/src/scene/engine-plugin.ts:113`).
 * `gwen:tween` is not a member. `TweenPlugin` is not a public factory
 * (`packages/core/src/internal.ts:68`), and no official plugin should name it.
 */
export const FRAMEWORK_PLUGIN_NAMES: readonly string[] = Object.freeze([
  "camera-core",
  "gwen:scene",
  "gwen:screen",
  "gwen:viewports",
]);
