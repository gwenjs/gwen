import type { ActorDefinition } from "../actor/runtime/types.js";
import type { GwenHotReport } from "./types.js";

/**
 * Inert stand-in for the red commit. The empty name fails every count assertion.
 * @internal
 */
export async function hotReplaceActor<Props, PublicAPI>(
  prev: ActorDefinition<Props, PublicAPI>,
  next: ActorDefinition<Props, PublicAPI>,
): Promise<GwenHotReport> {
  void prev;
  void next;
  return { status: "applied", kind: "actor", name: "", count: 0 };
}
