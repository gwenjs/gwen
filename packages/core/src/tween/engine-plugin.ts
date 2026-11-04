// packages/core/src/tween/engine-plugin.ts
import { createDisposable } from "../disposable.js";
import { TweenManager } from "./runtime/tween-manager.js";
import type { TweenPoolPolicy } from "./runtime/tween-pool.js";
import type { GwenPlugin, GwenEngineBase } from "@gwenjs/schema";

// ── Options ───────────────────────────────────────────────────────────────────

export interface TweenPluginOptions {
  poolSize?: number;
  poolPolicy?: TweenPoolPolicy;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Internal plugin managing the TweenManager singleton for this engine instance.
 *
 * Provides the `'tween:manager'` service via `engine.provide()`.
 * Cleanup is registered via `engine.disposables.add()` — the `GwenEngineBase` contract.
 *
 * @example
 * ```ts
 * await engine.use(TweenPlugin({ poolSize: 512 }))
 * const manager = engine.inject('tween:manager') as TweenManager
 * ```
 */
export function TweenPlugin(opts: TweenPluginOptions = {}): GwenPlugin {
  return {
    name: "gwen:tween",
    setup(engine: GwenEngineBase) {
      const log = engine.logger.child("@gwenjs/core/tween");
      const manager = new TweenManager(engine, opts.poolSize ?? 256, opts.poolPolicy, log);

      engine.provide("tween:manager", manager);

      // Cleanup via DisposableRegistry (GwenEngineBase contract) — not onCleanup().
      engine.disposables.add(
        "tween:manager",
        createDisposable(() => manager._shutdown()),
      );

      log.debug("tween manager ready", { poolSize: opts.poolSize ?? 256 });
    },
  };
}
