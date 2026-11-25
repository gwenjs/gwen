import type { ComponentDefinition, ComponentSchema } from "../schema";
import type { GwenHotReport } from "./types.js";

type Layout = Pick<ComponentDefinition<ComponentSchema>, "name" | "_fields">;

/** INERT: replaced by the real comparison in the next commit. */
export function hotCompareComponent(prev: Layout, next: Layout): GwenHotReport {
  void prev;
  void next;
  return { status: "applied", kind: "component", name: "", count: 0 };
}
