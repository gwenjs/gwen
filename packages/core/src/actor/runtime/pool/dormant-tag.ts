import { defineComponent } from "../../../schema";

/**
 * Zero-data tag component added to dormant pool slots.
 *
 * ECS queries that include `none: [DormantTag]` will automatically exclude
 * dormant actors. The pool also sets `_isDormant = true` on the `ActorInstance`
 * so that frame dispatchers (`onUpdate`, `onRender`, etc.) skip the instance
 * without needing a query.
 *
 * Both mechanisms work together:
 * - `DormantTag` → ECS query exclusion
 * - `_isDormant` flag → frame skip. Pool acquire/release still allocates (`pool.cycle`, #56).
 *
 * @example
 * ```ts
 * // Exclude dormant actors from a query manually
 * const active = useQuery([Position, Health]) // dormant already skipped by dispatcher
 * ```
 */
export const DormantTag = defineComponent({
  name: "DormantTag",
  schema: {},
});
