import { expectTypeOf } from "vitest";

import type { EntityId } from "../../src/engine/engine-api";
import { defineComponent, Types, type InferComponent } from "../../src/schema";
import * as system from "../../src/system/index.js";
import { useComponent, type ComponentHandle } from "../../src/system/index.js";
import * as actor from "../../src/actor/index.js";

// The name is split so that no source line carries the removed word.
type Removed = `useComponent${"For"}`;

// The per-entity export was replaced by the two-argument useComponent.
expectTypeOf<Extract<keyof typeof system, Removed>>().toBeNever();
// useComponent is exported by the system entry only.
expectTypeOf<Extract<keyof typeof actor, "useComponent">>().toBeNever();
// Positive controls: the absence probes above cannot pass vacuously.
expectTypeOf<Extract<keyof typeof system, "useComponent">>().toEqualTypeOf<"useComponent">();
expectTypeOf<Extract<keyof typeof actor, "useActor">>().toEqualTypeOf<"useActor">();

const Health = defineComponent({
  name: "Health",
  schema: { current: Types.f32, max: Types.f32 },
});

expectTypeOf<InferComponent<typeof Health>>().toEqualTypeOf<{
  current: number;
  max: number;
}>();

// useComponent(def) and useComponent(id, def) have the same ComponentHandle type
const fromActor = useComponent(Health);
const fromEntity = useComponent(0n as EntityId, Health);

expectTypeOf(fromActor).toEqualTypeOf(fromEntity);
expectTypeOf(fromActor).toEqualTypeOf<ComponentHandle<typeof Health>>();

fromActor.$set({ current: 1 });
fromEntity.$set({ max: 2 });

fromActor.$set({
  // @ts-expect-error unknown field
  nope: 1,
});
