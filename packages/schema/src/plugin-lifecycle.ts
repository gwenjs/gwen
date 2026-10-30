/**
 * Plugin object keys `engine.use` never calls, and the hook to register instead.
 * `onDestroy` and `onStop` both map to `engine:stop`.
 */
const hooks = {
  onBeforeUpdate: "engine:before-update",
  onUpdate: "engine:update",
  onAfterUpdate: "engine:after-update",
  onRender: "engine:render",
  onStart: "engine:start",
  onStop: "engine:stop",
  onDestroy: "engine:stop",
} as const;

export const GWEN_PLUGIN_LIFECYCLE_HOOKS = Object.freeze(hooks);

/** A key of {@link GWEN_PLUGIN_LIFECYCLE_HOOKS}. */
export type ForbiddenPluginKey = keyof typeof GWEN_PLUGIN_LIFECYCLE_HOOKS;

/** Own keys a plugin object may declare. */
export const GWEN_PLUGIN_KEYS = Object.freeze([
  "name",
  "setup",
  "teardown",
  "onError",
  "requires",
] as const);
