import type { ComponentDefinition, ComponentSchema } from "../schema";
import type { GwenHotReport } from "./types.js";

type Layout = Pick<ComponentDefinition<ComponentSchema>, "name" | "_fields">;

/** The first way `next` lays a component out differently from `prev`, or undefined. */
function firstDifference(prev: Layout, next: Layout): string | undefined {
  if (prev.name !== next.name) return `name "${prev.name}" -> "${next.name}"`;
  for (const field of prev._fields) {
    const other = next._fields.find((candidate) => candidate.name === field.name);
    if (other === undefined) return `field "${field.name}" removed`;
    if (other.type !== field.type) {
      return `field "${field.name}": type ${field.type} -> ${other.type}`;
    }
    if (other.byteOffset !== field.byteOffset) {
      return `field "${field.name}": byteOffset ${field.byteOffset} -> ${other.byteOffset}`;
    }
  }
  const added = next._fields.find(
    (field) => !prev._fields.some((candidate) => candidate.name === field.name),
  );
  return added === undefined ? undefined : `field "${added.name}" added`;
}

/**
 * Compare two definitions of one component: same name and same `(name, type, byteOffset)` fields.
 *
 * A component is not swapped in place. A matching layout keeps the engine type id and the stored
 * rows, so the report is `applied` with count 0. A different layout cannot reuse the rows: the
 * report is `reload`, and `detail` names the first difference (name, then each field of `prev`,
 * then fields only `next` has).
 *
 * @param prev - The definition the running engine was built with.
 * @param next - The edited definition.
 * @internal
 */
export function hotCompareComponent(prev: Layout, next: Layout): GwenHotReport {
  const detail = firstDifference(prev, next);
  if (detail === undefined) {
    return { status: "applied", kind: "component", name: prev.name, count: 0 };
  }
  return {
    status: "reload",
    kind: "component",
    name: prev.name,
    reason: "component-layout-changed",
    detail,
  };
}
