/**
 * Per-engine singleton manager for tween animations.
 * Lifecycle managed by TweenPlugin — do not instantiate directly.
 */
import { useEngine } from "../../engine/context.js";
import type { GwenEngine } from "../../engine/gwen-engine.js";
import type { TweenOptions, TweenableValue } from "./tween-types.js";
import { TweenPool, type TweenSlot } from "./tween-pool.js";
import type { TweenPoolPolicy } from "./tween-pool.js";
import type { IGwenLogger } from "@gwenjs/schema";

export class TweenManager {
  private _pool: TweenPool;

  constructor(
    engine: GwenEngine,
    poolSize: number = 256,
    policy?: TweenPoolPolicy,
    logger?: IGwenLogger,
  ) {
    this._pool = new TweenPool(poolSize, policy, logger);
    // Hook registered via the scoped proxy provided by engine.use() —
    // ScopedHooksTracker tracks it and removes it on engine.stop() / unuse().
    engine.hooks.hook("engine:tick", (dt: number) => {
      this._tick(dt);
    });
  }

  claim(options: TweenOptions<TweenableValue>): TweenSlot | null {
    return this._pool.claim(options);
  }

  release(slot: TweenSlot): void {
    this._pool.release(slot);
  }

  /** @internal Called by TweenPlugin via engine.disposables on engine.stop(). */
  _shutdown(): void {
    // Hooks are removed automatically by ScopedHooksTracker.
    // Placeholder for future pool cleanup logic (e.g. releasing TypedArray buffers).
  }

  private _tick(dt: number): void {
    this._pool.tick(dt);
  }
}

/**
 * Returns the TweenManager for the current engine via `engine.inject('tween:manager')`.
 * Requires `TweenPlugin` to be registered on the engine.
 *
 * @throws If TweenPlugin is not installed.
 */
export function getTweenManager(engine?: GwenEngine): TweenManager {
  const resolvedEngine = engine ?? (useEngine() as GwenEngine);
  return resolvedEngine.inject("tween:manager") as TweenManager;
}
