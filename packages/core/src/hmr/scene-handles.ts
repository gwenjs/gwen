import { createEngineLocal } from "../engine/engine-local.js";
import type { GwenEngine } from "../engine/engine-types.js";
import type { SystemHandle } from "../scene/runtime/system-handle.js";

/** Scene name to the handles of its systems, one map per engine. */
export const sceneHandles = createEngineLocal<Map<string, SystemHandle[]>>(() => new Map());

/** Record the handles of a scene on an engine. */
export function registerSceneHandles(
  engine: GwenEngine,
  name: string,
  handles: SystemHandle[],
): void {
  sceneHandles.get(engine).set(name, handles);
}
