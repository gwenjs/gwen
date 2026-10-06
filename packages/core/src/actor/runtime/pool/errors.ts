import { GwenError } from "@gwenjs/schema";
import { CoreErrorCodes } from "../../../engine/engine-errors";
/**
 * Thrown by `pool.acquire()` when all slots are active and no new entity can
 * be created because `size` has been reached.
 *
 * Catch this error to handle pool exhaustion gracefully — for example, by
 * skipping the spawn or deferring it until a slot is released.
 *
 * @example
 * ```ts
 * try {
 *   const id = EnemyPool.acquire({ hp: 100, x: 200, y: 300 })
 * } catch (e) {
 *   if (e instanceof PoolExhaustedError) {
 *     // pool full — skip this spawn
 *   }
 * }
 * ```
 */
export class PoolExhaustedError extends GwenError {
  /** Name of the actor whose pool is exhausted. */
  readonly actorName: string;
  /** Maximum pool size that was configured. */
  readonly poolSize: number;

  constructor(actorName: string, poolSize: number) {
    super(
      CoreErrorCodes.ACTOR_POOL_EXHAUSTED,
      `[GWEN] Pool exhausted: all ${poolSize} slots of actor "${actorName}" are active.\n` +
        `  Increase 'size' in defineActorPool options, or ensure release() is always called.\n` +
        `  Tip: if release() is called but the pool still exhausts, check pool.stats().peakActive ` +
        `to calibrate the right size.`,
    );
    this.name = "PoolExhaustedError";
    this.actorName = actorName;
    this.poolSize = poolSize;
  }
}
