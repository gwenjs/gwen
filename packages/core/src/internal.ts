/**
 * @gwenjs/core/internal — no semver guarantee.
 * Framework packages and generated code only.
 */

export { entityIndex } from "./types";

export { createGwenHooks } from "./hooks";
export { reportRejectedHook } from "./hooks/report-rejected-hook";

export { engineContext, executeAsync } from "./engine/context";

export { WasmBridgeImpl, getWasmBridge } from "./engine/wasm-bridge";
export type {
  WasmEntityId,
  WasmEngine,
  WasmEnginePhysics2D,
  WasmEnginePhysics3D,
  GwenCoreWasm,
  InitWasmOptions,
} from "./engine/wasm-bridge";

export {
  SharedMemoryManager,
  TRANSFORM_STRIDE,
  TRANSFORM3D_STRIDE,
  FLAG_PHYSICS_ACTIVE,
  FLAGS_OFFSET,
  SENTINEL,
  MAX_SAB_BYTES,
} from "./hooks/wasm/shared-memory";

export { buildTransformImports } from "./hooks/wasm/transform-imports";
export type { GwenTransformImports } from "./hooks/wasm/transform-imports";

export {
  TRANSFORM_OFFSETS,
  Transform3D,
  readTransform3DPosition,
  readTransform3DRotation,
  readTransform3DScale,
  writeTransform3DPosition,
  writeTransform3DRotation,
  writeTransform3DScale,
} from "./components/transform3d";

export { GlobalStringPoolManager, StringPoolManager, StringPool } from "./utils/string-pool";

export { detectCoreVariant } from "./utils/variant-detector";

export { createDisposable } from "./disposable";

export { EASING_MAP } from "./tween/runtime/easing";
export { TweenPool } from "./tween/runtime/tween-pool";
export type { TweenSlot, TweenPoolPolicy } from "./tween/runtime/tween-pool";
export { TweenManager, getTweenManager } from "./tween/runtime/tween-manager";
export { TweenPlugin } from "./tween/engine-plugin";
export type { TweenPluginOptions } from "./tween/engine-plugin";

export { _getActorEntityId } from "./actor/runtime/define-actor";

export { GwenScope } from "./context/scope";
