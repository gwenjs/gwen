/**
 * Typed error codes for all GWEN domains.
 *
 * Use these constants instead of raw strings in `GwenComposableError` so
 * catch-blocks can branch on stable codes without parsing message strings.
 *
 * @example
 * ```ts
 * throw new GwenComposableError(GwenErrorCode.Actor.OUTSIDE_CONTEXT, '...');
 * ```
 */
export const GwenErrorCode = {
  Actor: {
    OUTSIDE_CONTEXT: "actor:outside-context",
    INVALID_PREFAB: "actor:invalid-prefab",
    POOL_EXHAUSTED: "actor:pool-exhausted",
    ALREADY_DESPAWNED: "actor:already-despawned",
  },
  System: {
    OUTSIDE_CONTEXT: "system:outside-context",
    DUPLICATE_REGISTER: "system:duplicate-register",
  },
  Scene: {
    OUTSIDE_CONTEXT: "scene:outside-context",
    NOT_FOUND: "scene:not-found",
    ALREADY_ACTIVE: "scene:already-active",
  },
  Engine: {
    NOT_INITIALIZED: "engine:not-initialized",
    PLUGIN_SETUP_FAILED: "engine:plugin-setup-failed",
    WASM_LOAD_FAILED: "engine:wasm-load-failed",
  },
  Query: {
    INVALID_TYPE: "query:invalid-type",
  },
} as const;

export type GwenErrorCode =
  (typeof GwenErrorCode)[keyof typeof GwenErrorCode][keyof (typeof GwenErrorCode)[keyof typeof GwenErrorCode]];
