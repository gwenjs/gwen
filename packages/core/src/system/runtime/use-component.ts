import { useEngine } from "../../engine/context";
import type { EntityId } from "../../engine/engine-api";
import type { InferComponent } from "../../schema";
import type { ComponentDef } from "./define-system";

/**
 * Returns a mutable proxy for a component on a specific entity, for use inside
 * a {@link defineSystem} setup callback.
 *
 * Reading a field (`proxy.x`) returns the current value from ECS storage.
 * Writing a field (`proxy.x = value`) calls `addComponent` to persist the change.
 * Use `proxy.$set({ ... })` to update multiple fields in a single ECS write.
 *
 * The GWEN Vite optimizer detects this pattern inside `for...of` loops and
 * rewrites it to bulk WASM calls (`queryReadBulk` / `queryWriteBulk`), eliminating
 * per-entity overhead at build time.
 *
 * Must be called inside a `defineSystem` setup callback (active engine context).
 *
 * @param entityId - The entity to read/write.
 * @param def      - The component definition.
 * @returns A mutable proxy backed by ECS storage, plus a `$set` helper.
 *
 * @example
 * ```ts
 * export const MovementSystem = defineSystem(() => {
 *   const entities = useQuery([Position, Velocity])
 *
 *   onUpdate((dt) => {
 *     for (const entity of entities) {
 *       const pos = useComponentFor(entity.id, Position)
 *       const vel = useComponentFor(entity.id, Velocity)
 *       pos.x += vel.x * dt
 *       pos.y += vel.y * dt
 *     }
 *   })
 * })
 * ```
 *
 * @example
 * ```ts
 * // Batch write — one ECS call regardless of field count:
 * pos.$set({ x: pos.x + vel.x * dt, y: pos.y + vel.y * dt })
 * ```
 */
type ComponentProxy<D extends ComponentDef> = InferComponent<D> & {
  $set(patch: Partial<InferComponent<D>>): void;
};

export function useComponentFor<D extends ComponentDef>(
  entityId: EntityId,
  def: D,
): ComponentProxy<D> {
  const engine = useEngine();

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
