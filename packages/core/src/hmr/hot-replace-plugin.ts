import type { GwenEngine, GwenPlugin } from "../engine/engine-types.js";
import type { GwenHotReport } from "./types.js";

/** Inert until commit 2. */
export async function hotReplacePlugin(
  _engine: GwenEngine,
  _prevName: string,
  _next: GwenPlugin,
): Promise<GwenHotReport> {
  return { status: "applied", kind: "plugin", name: "", count: 0 };
}
