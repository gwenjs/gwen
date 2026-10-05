// packages/core/src/scene/engine-plugin.ts
import { createDisposable } from "../disposable.js";
import { engineContext } from "../engine/context.js";
import type { GwenPlugin, GwenEngineBase } from "@gwenjs/schema";
import type { SceneDefinition } from "./runtime/define-scene.js";

// ── GwenProvides augmentation ─────────────────────────────────────────────────
// Augments gwen-engine.js so the service is properly typed.
// Same pattern as SceneRegistrar (from scene-registrar.ts).
declare module "../engine/engine-types.js" {
  interface GwenProvides {
    "scene:hook-registry": SceneHookRegistry;
  }
}

// ── SceneHookRegistry ─────────────────────────────────────────────────────────

/**
 * Registry of scene lifecycle hook handlers, enabling guaranteed cleanup via
 * `engine.hooks.removeHook()` on engine stop or plugin unuse.
 *
 * `HookBusBase.hook()` returns `void` — handler references are stored directly
 * so `removeHook(event, fn)` can be called in `dispose()`.
 */
export class SceneHookRegistry {
  private _cleanups: Array<() => void> = [];

  /**
   * Registers the lifecycle hooks of a `SceneDefinition` on the engine.
   * Stores handler references for automatic deregistration on cleanup.
   */
  hookScene(engine: import("../engine/gwen-engine.js").GwenEngine, def: SceneDefinition): void {
    const { name } = def;

    if (def.onEnter) {
      const enterCb = def.onEnter;
      const handler = async (sceneName: string, params?: Record<string, unknown>) => {
        if (sceneName !== name) return;
        engineContext.set(engine, true);
        try {
          await enterCb(params);
        } finally {
          engineContext.unset();
        }
      };
      engine.hooks.hook("scene:enter", handler);
      this._cleanups.push(() => engine.hooks.removeHook("scene:enter", handler));
    }

    if (def.onExit) {
      const exitCb = def.onExit;
      const handler = async (sceneName: string) => {
        if (sceneName !== name) return;
        engineContext.set(engine, true);
        try {
          await exitCb();
        } finally {
          engineContext.unset();
        }
      };
      engine.hooks.hook("scene:beforeLeave", handler);
      this._cleanups.push(() => engine.hooks.removeHook("scene:beforeLeave", handler));
    }

    if (def.onTransitionLeave) {
      const leaveCb = def.onTransitionLeave;
      const handler = async (payload: { from: string; to: string }) => {
        if (payload.from !== name) return;
        engineContext.set(engine, true);
        try {
          await leaveCb(payload);
        } finally {
          engineContext.unset();
        }
      };
      engine.hooks.hook("scene:transition:leave", handler);
      this._cleanups.push(() => engine.hooks.removeHook("scene:transition:leave", handler));
    }

    if (def.onTransitionEnter) {
      const enterCb = def.onTransitionEnter;
      const handler = async (payload: { from: string; to: string }) => {
        if (payload.to !== name) return;
        engineContext.set(engine, true);
        try {
          await enterCb(payload);
        } finally {
          engineContext.unset();
        }
      };
      engine.hooks.hook("scene:transition:enter", handler);
      this._cleanups.push(() => engine.hooks.removeHook("scene:transition:enter", handler));
    }
  }

  /** Removes all registered hook handlers. Called by engine.disposables on cleanup. */
  dispose(): void {
    for (const off of this._cleanups) off();
    this._cleanups = [];
  }
}

// ── Plugin factory ────────────────────────────────────────────────────────────

/**
 * Internal plugin providing the `SceneHookRegistry` service.
 * Must be registered BEFORE scene factories are called.
 *
 * Cleanup is guaranteed via `engine.disposables.add()` — the `GwenEngineBase` contract.
 */
export function SceneEnginePlugin(): GwenPlugin {
  return {
    name: "gwen:scene",
    setup(engine: GwenEngineBase) {
      const registry = new SceneHookRegistry();
      engine.provide("scene:hook-registry", registry);
      engine.disposables.add(
        "scene:hook-registry",
        createDisposable(() => registry.dispose()),
      );
    },
  };
}
