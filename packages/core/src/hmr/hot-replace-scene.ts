import type { SceneFactory } from "../scene/runtime/define-scene.js";
import type { GwenHotReport } from "./types.js";

/** Inert stand-in. The real swap replaces this body. */
export async function hotReplaceScene(
  prev: SceneFactory,
  _next: SceneFactory,
): Promise<GwenHotReport> {
  void prev;
  return { status: "applied", kind: "scene", name: "", count: 0 };
}
