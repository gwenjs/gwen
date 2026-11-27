import type { LayoutDefinition, PlaceHandle } from "../actor/runtime/types.js";
import type { GwenHotReport } from "./types.js";

/**
 * Inert stand-in for the red commit. The empty name fails every count assertion.
 * @internal
 */
export async function hotReplaceLayout<Refs extends Record<string, PlaceHandle<unknown>>>(
  prev: LayoutDefinition<Refs>,
  next: LayoutDefinition<Refs>,
): Promise<GwenHotReport> {
  void prev;
  void next;
  return { status: "applied", kind: "layout", name: "", count: 0 };
}
