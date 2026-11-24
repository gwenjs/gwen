import type { GwenEngine } from "@gwenjs/core";

/** One `beforeEach` spy. `stop` removes it. */
export interface HookRecording {
  /** Start keeping names. Call this before `engine.use` so `setup` emits count. */
  arm(): void;
  /** Remove the spy. Safe to call once, when the run ends. */
  stop(): void;
}

/**
 * Install `engine.hooks.beforeEach` (`packages/core/src/engine/hook-dispatch.ts:260`).
 * The spy is not counted in `hookListeners` (`packages/core/src/engine/hook-dispatch.ts:301`).
 * Names stay out until `arm`, so the caller can open the window at `use`.
 */
export function startHookRecording(
  engine: GwenEngine,
  onName: (name: string) => void,
): HookRecording {
  let armed = false;
  const unsubscribe = engine.hooks.beforeEach((event) => {
    if (!armed) return;
    onName(event.name);
  });
  return {
    arm() {
      armed = true;
    },
    stop() {
      unsubscribe();
    },
  };
}
