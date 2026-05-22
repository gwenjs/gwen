import { useEngine } from "../../engine/context";
import type { EntityId } from "../../engine/engine-api";
import type { ComponentDefinition, ComponentSchema, InferComponent } from "../../schema";

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
 *       const pos = useComponent(entity.id, Position)
 *       const vel = useComponent(entity.id, Velocity)
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
export function useComponent<S extends ComponentSchema, D extends ComponentDefinition<S>>(
  entityId: EntityId,
  def: D,
): InferComponent<D> & { $set(values: Partial<InferComponent<D>>): void } {
  const engine = useEngine();
  const typedDef = def as ComponentDefinition<ComponentSchema>;

  return new Proxy({} as InferComponent<D>, {
    get(_target, prop: string | symbol): unknown {
      if (prop === "$set") {
        return (values: Partial<InferComponent<D>>) => {
          engine.addComponent(
            entityId,
            typedDef,
            values as Partial<InferComponent<typeof typedDef>>,
          );
        };
      }
      if (typeof prop !== "string") return undefined;
      const comp = engine.getComponent(entityId, typedDef) as Record<string, unknown> | undefined;
      return comp?.[prop];
    },

    set(_target, prop: string | symbol, value: unknown): boolean {
      if (typeof prop !== "string") return false;
      engine.addComponent(entityId, typedDef, { [prop]: value } as Partial<
        InferComponent<typeof typedDef>
      >);
      return true;
    },
  }) as InferComponent<D> & { $set(values: Partial<InferComponent<D>>): void };
}
