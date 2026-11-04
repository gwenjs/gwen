import { useEngine } from "../../engine/context";
import type { GwenEngine } from "../../engine/engine-types";
import type { EntityId } from "../../engine/engine-api";
import { warnPerEntityPath } from "../../engine/engine-internals";
import type { InferComponent } from "../../schema";
import { _getActorEngine, _getActorEntityId } from "../../actor/runtime/define-actor";
import type { ComponentDef } from "./define-system";

/** Mutable handle for one component on one entity: field reads, field writes and `$set`. */
export type ComponentHandle<D extends ComponentDef> = InferComponent<D> & {
  $set(patch: Partial<InferComponent<D>>): void;
};

function componentHandle<D extends ComponentDef>(
  entityId: EntityId,
  def: D,
  engine: GwenEngine,
): ComponentHandle<D> {
  warnPerEntityPath(engine, "useComponent");
  const target = {} as ComponentHandle<D>; // boundary: Proxy target: the handle has no own keys, every read and write goes through the traps
  return new Proxy(target, {
    get(_target, prop: string | symbol): unknown {
      if (prop === "$set") {
        return (values: Partial<InferComponent<D>>) => {
          engine.addComponent(entityId, def, values);
        };
      }
      if (typeof prop !== "string") return undefined;
      const comp = engine.getComponent(entityId, def);
      if (comp === undefined || !(prop in comp)) return undefined;
      return Reflect.get(comp, prop);
    },

    set(_target, prop: string | symbol, value: unknown): boolean {
      if (typeof prop !== "string") return false;
      const patch: Partial<InferComponent<D>> = {};
      Reflect.set(patch, prop, value);
      engine.addComponent(entityId, def, patch);
      return true;
    },
  });
}

/**
 * Returns a mutable handle for the current actor's component.
 *
 * Call it synchronously inside a `defineActor()` factory. The entity and engine
 * are captured at call time, so `onUpdate` callbacks use the handle without an
 * active context. Called during an update phase (an actor spawned from a system
 * update hook), it logs `CORE:QUERY_PER_ENTITY_PATH` once per engine.
 *
 * Reading a field returns the current value from ECS storage. Writing a field
 * calls `addComponent` and allocates one patch object. `handle.$set({ ... })`
 * writes several fields in one call.
 *
 * @param def - The component definition.
 * @returns A mutable handle backed by ECS storage, plus a `$set` helper.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ACTOR_CONTEXT` if called outside an actor factory.
 *
 * @example
 * ```ts
 * const Actor = defineActor(PosPrefab, () => {
 *   const pos = useComponent(Position)
 *   onUpdate((dt) => {
 *     pos.$set({ x: pos.x + 100 * dt, y: pos.y + 50 * dt })
 *   })
 * })
 * ```
 */
export function useComponent<D extends ComponentDef>(def: D): ComponentHandle<D>;
/**
 * Returns a mutable handle for one component on any entity, from a system or an actor.
 *
 * It reads one entity at a time. During `onBeforeUpdate`, `onUpdate`, and
 * `onAfterUpdate` it logs `CORE:QUERY_PER_ENTITY_PATH` once per engine. In a
 * hot loop, iterate the query by chunk (`for (const chunk of query)`).
 *
 * Reading a field returns the current value from ECS storage. Writing a field
 * calls `addComponent` and allocates one patch object. `handle.$set({ ... })`
 * writes several fields in one call.
 *
 * @param entityId - The entity to read or write.
 * @param def - The component definition.
 * @param engine - Engine that owns the entity. Defaults to the active engine.
 * @returns A mutable handle backed by ECS storage, plus a `$set` helper.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` if no engine context is active and `engine` is omitted.
 *
 * @example
 * ```ts
 * const pos = useComponent(id, Position)
 * pos.$set({ x: pos.x + 1, y: pos.y })
 * ```
 */
export function useComponent<D extends ComponentDef>(
  entityId: EntityId,
  def: D,
  engine?: GwenEngine,
): ComponentHandle<D>;
export function useComponent<D extends ComponentDef>(
  ...args: [def: D] | [entityId: EntityId, def: D, engine?: GwenEngine | undefined]
): ComponentHandle<D> {
  if (args.length === 1) {
    return componentHandle(
      _getActorEntityId("useComponent"),
      args[0],
      _getActorEngine("useComponent"),
    );
  }
  return componentHandle(args[0], args[1], args[2] ?? useEngine("useComponent"));
}
