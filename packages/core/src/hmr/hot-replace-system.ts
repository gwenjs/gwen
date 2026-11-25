import type { DiscoverablePlugin } from "../system/runtime/define-system";
import type { GwenHotReport } from "./types.js";

/** INERT: replaced by the real swap in the next commit. */
export async function hotReplaceSystem<Args extends unknown[]>(
  prev: (...args: Args) => DiscoverablePlugin,
  next: (...args: Args) => DiscoverablePlugin,
): Promise<GwenHotReport> {
  void prev;
  void next;
  return { status: "applied", kind: "system", name: "", count: 0 };
}
