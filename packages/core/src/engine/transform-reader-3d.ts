/**
 * The engine-owned `transform:3d` reader. Refs are opaque and per engine. `read` allocates
 * nothing and makes no WASM call: it reads the history views of the fixed-step state.
 * The raw world path lives in `useTransform3D`, so a bundle that never imports it
 * does not ship that read.
 * @internal
 */

import type { Hookable } from "hookable";
import type {
  EntityId,
  TransformReader3D,
  TransformRef3D,
  TransformSample3D,
} from "@gwenjs/schema";
import { entityIndex } from "../types/entity";
import { GwenTransformRefError } from "./engine-errors.js";
import type { FixedStepState } from "./fixed-display.js";
import type { GwenRuntimeHooks } from "./runtime-hooks.js";
import { readRenderPose3D } from "./transform-pair-3d.js";

/** Collaborators of one engine's 3D reader. */
export interface TransformReader3DDeps {
  readonly hooks: Hookable<GwenRuntimeHooks>;
  /** The loop's fixed-step state: the history views and the frame. */
  readonly fixed: FixedStepState;
  readonly isAlive: (id: EntityId) => boolean;
  readonly isStopped: () => boolean;
  readonly physicsHz: () => number;
}

// `TransformRef3D` carries a brand symbol that the schema does not export. `keyof` names it
// without a cast, and `declare` emits no field.
declare const brand: keyof TransformRef3D;

/** One tracked slot. `live` drops to false on `release` and on `entity:destroy`. */
class Ref implements TransformRef3D {
  declare readonly [brand]: true;
  live = true;

  constructor(
    readonly owner: TransformReader3DImpl,
    readonly slot: number,
  ) {}
}

/**
 * Provided under `transform:3d` by every core engine.
 *
 * `track` asks the loop for a 3D history commit, including at `physicsHz: 0`. The views
 * appear on the next commit, so a ref reads false until then. Before the first `track`,
 * and with no `useTransform3D()` at `physicsHz > 0`, there is no commit and no buffer.
 * Once wanted, the commit stays on.
 */
export class TransformReader3DImpl implements TransformReader3D {
  private readonly _bySlot = new Map<number, Ref[]>();
  private readonly _pose: TransformSample3D = {
    x: 0,
    y: 0,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  };
  private _listening = false;

  constructor(private readonly deps: TransformReader3DDeps) {}

  track(entity: EntityId): TransformRef3D {
    const slot = entityIndex(entity);
    if (this.deps.isStopped()) throw new GwenTransformRefError("engine-stopped", "3D");
    if (!this.deps.isAlive(entity)) throw new GwenTransformRefError("dead-entity", "3D");
    this._listen();
    this.deps.fixed.history3dWanted = true;
    const ref = new Ref(this, slot);
    const refs = this._bySlot.get(slot);
    if (refs === undefined) this._bySlot.set(slot, [ref]);
    else refs.push(ref);
    return ref;
  }

  release(ref: TransformRef3D): void {
    if (!(ref instanceof Ref) || ref.owner !== this || !ref.live) return;
    ref.live = false;
    const refs = this._bySlot.get(ref.slot);
    if (refs === undefined) return;
    const index = refs.indexOf(ref);
    if (index >= 0) refs.splice(index, 1);
    if (refs.length === 0) this._bySlot.delete(ref.slot);
  }

  read(ref: TransformRef3D, out: TransformSample3D): boolean {
    if (!(ref instanceof Ref) || ref.owner !== this) {
      throw new GwenTransformRefError("foreign-engine", "3D");
    }
    if (!ref.live) return false;
    const history = this.deps.fixed.history3d;
    if (history === null) return false;
    return readRenderPose3D(history.pair, ref.slot, this.deps.fixed.frame, out);
  }

  /**
   * The published pose of `slot` while rendering, for `useTransform3D().world`.
   * `undefined` outside `engine:render`, at `physicsHz: 0`, or when the slot has no node.
   * The returned sample is reused by the next call.
   * @internal
   */
  renderedPose(slot: number): TransformSample3D | undefined {
    const frame = this.deps.fixed.frame;
    if (!frame.rendering || this.deps.physicsHz() === 0) return undefined;
    const history = this.deps.fixed.history3d;
    if (history === null) return undefined;
    return readRenderPose3D(history.pair, slot, frame, this._pose) ? this._pose : undefined;
  }

  /**
   * `useTransform3D()` wants a 3D history only while `physicsHz() > 0`, so `world` can
   * interpolate with no tracked ref. At `physicsHz: 0` the call changes nothing.
   * @internal
   */
  wantHistory(): void {
    const hz = this.deps.physicsHz();
    if (hz > 0) this.deps.fixed.history3dWanted = true;
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
