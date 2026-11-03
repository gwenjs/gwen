import { expectTypeOf, it } from "vitest";

import { defineComponent, Types } from "../../src/schema";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { defineActorPool } from "../../src/actor/runtime/pool/define-actor-pool";
import { useActorPool } from "../../src/actor/runtime/pool/use-actor-pool";
import type { ActorPool } from "../../src/actor/runtime/pool/types";
import type { GwenPlugin } from "../../src/engine/engine-types";

const Position = defineComponent({
  name: "ComposablesPosition",
  schema: { x: Types.f32 },
});

const prefab = definePrefab([{ def: Position, defaults: { x: 0 } }]);

const Actor = defineActor(prefab, (props: { hp: number }) => ({ hp: props.hp }));
const poolDefinition = defineActorPool(Actor, { size: 2 });

it("definition has no acquire and useActorPool returns the handle", () => {
  // the definition is not a pool: only the handle has acquire
  expectTypeOf(poolDefinition).not.toHaveProperty("acquire");
  expectTypeOf(useActorPool(poolDefinition)).toHaveProperty("acquire");
  expectTypeOf(useActorPool(poolDefinition)).toEqualTypeOf<
    ActorPool<{ hp: number }, { hp: number }>
  >();
  // useComponentFor does not exist: useComponent has both forms
  expectTypeOf<
    Extract<keyof typeof import("../../src/system/index"), "useComponentFor">
  >().toEqualTypeOf<never>();
  // onTransitionLeave does not exist: the hook is onTransitionExit
  expectTypeOf<
    Extract<keyof typeof import("../../src/scene/index"), "onTransitionLeave">
  >().toEqualTypeOf<never>();
});

it("ActorDefinition.plugin is the public GwenPlugin", () => {
  expectTypeOf(Actor.plugin).toEqualTypeOf<GwenPlugin>();
});
