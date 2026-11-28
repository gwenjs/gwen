// packages/core/src/scene/engine-plugin.ts
import { createDisposable } from "../disposable.js";
import { popEngine, pushEngine } from "../engine/engine-local.js";
import type { GwenPlugin, GwenEngineBase, GwenSceneName, ScenePreloadEvent } from "@gwenjs/schema";
import type { SceneDefinition } from "./runtime/define-scene.js";

// ── GwenProvides augmentation ─────────────────────────────────────────────────
// Augments `@gwenjs/schema` so the service is properly typed.
// Same pattern as SceneRegistrar (from scene-registrar.ts).
declare module "@gwenjs/schema" {
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
  private _byName = new Map<string, Array<() => void>>();

  /**
   * Registers the lifecycle hooks of a `SceneDefinition` on the engine.
   * The first registration of a name wins. A second call does nothing, so a
   * swap can build the next factory while the name is still hooked.
   * Stores handler references for automatic deregistration on cleanup.
   */
  hookScene(engine: import("../engine/engine-types.js").GwenEngine, def: SceneDefinition): void {
    const { name } = def;
    if (this._byName.has(name)) return;
    const cleanups: Array<() => void> = [];
    this._byName.set(name, cleanups);

    if (def.onEnter) {
      const enterCb = def.onEnter;
      const handler = async (sceneName: string, params?: Record<string, unknown>) => {
        if (sceneName !== name) return;
        const previous = pushEngine(engine);
        try {
          await enterCb(params);
        } finally {
          popEngine(engine, previous);
        }
      };
      engine.hooks.hook("scene:enter", handler);
      cleanups.push(() => engine.hooks.removeHook("scene:enter", handler));
    }

    if (def.onExit) {
      const exitCb = def.onExit;
      const handler = async (sceneName: string) => {
        if (sceneName !== name) return;
        const previous = pushEngine(engine);
        try {
          await exitCb();
        } finally {
          popEngine(engine, previous);
        }
      };
      engine.hooks.hook("scene:beforeLeave", handler);
      cleanups.push(() => engine.hooks.removeHook("scene:beforeLeave", handler));
    }

    if (def.onTransitionExit) {
      const leaveCb = def.onTransitionExit;
      const handler = async (payload: { from: GwenSceneName; to: GwenSceneName }) => {
        if (payload.from !== name) return;
        const previous = pushEngine(engine);
        try {
          await leaveCb(payload);
        } finally {
          popEngine(engine, previous);
        }
      };
      engine.hooks.hook("scene:transition:leave", handler);
      cleanups.push(() => engine.hooks.removeHook("scene:transition:leave", handler));
    }

    if (def.onTransitionEnter) {
      const enterCb = def.onTransitionEnter;
      const handler = async (payload: { from: GwenSceneName; to: GwenSceneName }) => {
        if (payload.to !== name) return;
        const previous = pushEngine(engine);
        try {
          await enterCb(payload);
        } finally {
          popEngine(engine, previous);
        }
      };
      engine.hooks.hook("scene:transition:enter", handler);
      cleanups.push(() => engine.hooks.removeHook("scene:transition:enter", handler));
    }

    if (def.onPreload) {
      const cbs = def.onPreload;
      const handler = async (event: ScenePreloadEvent) => {
        if (event.to !== name) return;
        const previous = pushEngine(engine);
        try {
          await Promise.all(cbs.map(async (cb) => cb(event)));
        } finally {
          popEngine(engine, previous);
        }
      };
      engine.hooks.hook("scene:preload", handler);
      cleanups.push(() => engine.hooks.removeHook("scene:preload", handler));
    }
  }

  /** Append a cleanup `unhookScene` and `dispose` both run. No-op when `name` is not hooked. */
  addSceneCleanup(name: string, off: () => void): void {
    this._byName.get(name)?.push(off);
  }

  /** Drops the handlers registered for one scene and leaves every other scene in place. */
  unhookScene(name: string): void {
    const cleanups = this._byName.get(name);
    if (cleanups === undefined) return;
    for (const off of cleanups) off();
    this._byName.delete(name);
  }

  /** Removes all registered hook handlers. Called by engine.disposables on cleanup. */
  dispose(): void {
    for (const cleanups of this._byName.values()) {
      for (const off of cleanups) off();
    }
    this._byName.clear();
  }
}

/**
 * Dev-only map from a registry to the scene names whose `scene:enter` ran and
 * whose `scene:beforeLeave` has not. The first dev note creates it, inside
 * `if (__GWEN_DEV__)`. A production bundle never builds the map.
 */
let devEntered: WeakMap<SceneHookRegistry, Set<string>> | undefined;

/** Record that `name` is the entered scene (`present`) or that it just left. */
export function devNoteScenePresence(
  registry: SceneHookRegistry,
  name: string,
  present: boolean,
): void {
  if (__GWEN_DEV__) {
    let map = devEntered;
    if (map === undefined) {
      map = new WeakMap();
      devEntered = map;
    }
    let names = map.get(registry);
    if (names === undefined) {
      names = new Set();
      map.set(registry, names);
    }
    if (present) names.add(name);
    else names.delete(name);
  }
}

/** True when a dev build saw `scene:enter` for `name` and no later leave. */
export function sceneIsEntered(registry: SceneHookRegistry, name: string): boolean {
  if (__GWEN_DEV__) {
    const names = devEntered?.get(registry);
    if (names !== undefined) return names.has(name);
  }
  return false;
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
    provides: ["scene:hook-registry"],
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
