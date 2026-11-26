/**
 * The engine-owned `transform:2d` reader. Refs are opaque and per engine. `read` allocates
 * nothing and makes no WASM call: it reads the history views of the fixed-step state.
 * @internal
 */

import type { Hookable } from "hookable";
import type {
  EntityId,
  TransformReader2D,
  TransformRef2D,
  TransformSample2D,
} from "@gwenjs/schema";
import { entityIndex } from "../types/entity";
import { GwenTransformRefError } from "./engine-errors.js";
import type { FixedStepState } from "./fixed-display.js";
import type { GwenRuntimeHooks } from "./runtime-hooks.js";
import { readRenderPose2D } from "./transform-pair.js";

/** Collaborators of one engine's reader. */
export interface TransformReader2DDeps {
  readonly hooks: Hookable<GwenRuntimeHooks>;
  /** The loop's fixed-step state: the history views and the frame. */
  readonly fixed: FixedStepState;
  readonly isAlive: (id: EntityId) => boolean;
  readonly isStopped: () => boolean;
}

// `TransformRef2D` carries a brand symbol that the schema does not export. `keyof` names it
// without a cast, and `declare` emits no field.
declare const brand: keyof TransformRef2D;

/** One tracked slot. `live` drops to false on `release` and on `entity:destroy`. */
class Ref implements TransformRef2D {
  declare readonly [brand]: true;
  live = true;

  constructor(
    readonly owner: TransformReader2DImpl,
    readonly slot: number,
  ) {}
}

/**
 * Provided under `transform:2d` by every core engine.
 *
 * `track` at `physicsHz: 0` asks the loop for a per-frame history commit. The views appear on
 * the next frame, so a ref reads false until then. With no ref tracked there is no commit and
 * no buffer.
 */
export class TransformReader2DImpl implements TransformReader2D {
  private readonly _bySlot = new Map<number, Ref[]>();
  private readonly _pose: TransformSample2D = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  private _listening = false;

  constructor(private readonly deps: TransformReader2DDeps) {}

  track(entity: EntityId): TransformRef2D {
    const slot = entityIndex(entity);
    if (this.deps.isStopped()) throw new GwenTransformRefError("engine-stopped");
    if (!this.deps.isAlive(entity)) throw new GwenTransformRefError("dead-entity");
    this._listen();
    this.deps.fixed.historyWanted = true;
    const ref = new Ref(this, slot);
    const refs = this._bySlot.get(slot);
    if (refs === undefined) this._bySlot.set(slot, [ref]);
    else refs.push(ref);
    return ref;
  }

  release(ref: TransformRef2D): void {
    if (!(ref instanceof Ref) || ref.owner !== this || !ref.live) return;
    ref.live = false;
    const refs = this._bySlot.get(ref.slot);
    if (refs === undefined) return;
    const index = refs.indexOf(ref);
    if (index >= 0) refs.splice(index, 1);
    if (refs.length === 0) this._bySlot.delete(ref.slot);
  }

  read(ref: TransformRef2D, out: TransformSample2D): boolean {
    if (!(ref instanceof Ref) || ref.owner !== this)
      throw new GwenTransformRefError("foreign-engine");
    if (!ref.live) return false;
    const history = this.deps.fixed.history;
    if (history === null) return false;
    return readRenderPose2D(history.pair, ref.slot, this.deps.fixed.frame, out);
  }

  /**
   * The published pose of `slot` while rendering, for `useTransform().world`. No ref and no
   * `track`: `undefined` at `physicsHz: 0`, where the pair is not published. The returned
   * sample is reused by the next call.
   * @internal
   */
  renderedPose(slot: number): TransformSample2D | undefined {
    const frame = this.deps.fixed.frame;
    if (!frame.rendering) return undefined;
    const pair = frame.transforms2D;
    if (pair === null) return undefined;
    return readRenderPose2D(pair, slot, frame, this._pose) ? this._pose : undefined;
  }

  /** One `entity:destroy` listener, installed on the first `track`. */
  private _listen(): void {
    if (this._listening) return;
    this._listening = true;
    this.deps.hooks.hook("entity:destroy", (id) => {
      const slot = entityIndex(id);
      const refs = this._bySlot.get(slot);
      if (refs === undefined) return;
      for (const ref of refs) ref.live = false;
      this._bySlot.delete(slot);
    });
  }
}
