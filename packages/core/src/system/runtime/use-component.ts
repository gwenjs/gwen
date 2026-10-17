import { useEngine } from "../../engine/context";
import type { GwenEngine } from "../../engine/engine-types";
import type { EntityId } from "../../engine/engine-api";
import { warnPerEntityPath } from "../../engine/engine-internals";
import type { InferComponent } from "../../schema";
import type { ComponentDef } from "./define-system";

type ComponentProxy<D extends ComponentDef> = InferComponent<D> & {
  $set(patch: Partial<InferComponent<D>>): void;
};

/**
 * Returns a mutable proxy for one component on one entity.
 *
 * Reading a field returns the current value from ECS storage.
 * Writing a field calls `addComponent`. `proxy.$set({ ... })` writes several
 * fields in one call.
 *
 * @deprecated During `onBeforeUpdate`, `onUpdate`, and `onAfterUpdate`, iterate
 * the query by chunk (`for (const chunk of query)`) instead of reading one entity
 * at a time.
 *
 * @param entityId - The entity to read or write.
 * @param def - The component definition.
 * @param engine - Engine that owns the entity. Defaults to the active engine.
 * @returns A mutable proxy backed by ECS storage, plus a `$set` helper.
 *
 * @example
 * ```ts
 * export const MovementSystem = defineSystem(() => {
 *   const motion = useQuery([Position, Velocity])
 *
 *   onUpdate((dt) => {
 *     for (const chunk of motion) {
 *       const pos = chunk.get(Position)
 *       const vel = chunk.get(Velocity)
 *       for (let row = 0; row < chunk.count; row++) {
 *         pos.x[row] += vel.x[row] * dt
 *         pos.y[row] += vel.y[row] * dt
 *       }
 *     }
 *   })
 * })
 * ```
 *
 * @example
 * ```ts
 * const pos = useComponentFor(id, Position)
 * pos.$set({ x: pos.x + 1, y: pos.y })
 * ```
 */
export function useComponentFor<D extends ComponentDef>(
  entityId: EntityId,
  def: D,
  engine: GwenEngine = useEngine(),
): ComponentProxy<D> {
  warnPerEntityPath(engine, "useComponentFor");
  return new Proxy({} as ComponentProxy<D>, {
    get(_target, prop: string | symbol): unknown {
      if (prop === "$set") {
        return (values: Partial<InferComponent<D>>) => {
          engine.addComponent(entityId, def, values);
        };
      }
      if (typeof prop !== "string") return undefined;
      const comp = engine.getComponent(entityId, def);
      if (comp === undefined || !(prop in comp)) return undefined;
      return comp[prop as keyof InferComponent<D>];
    },

    set(_target, prop: string | symbol, value: unknown): boolean {
      if (typeof prop !== "string") return false;
      const patch: Partial<InferComponent<D>> = {};
      patch[prop as keyof InferComponent<D>] = value as InferComponent<D>[keyof InferComponent<D>];
      engine.addComponent(entityId, def, patch);
      return true;
    },
  });
}
