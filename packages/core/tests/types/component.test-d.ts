import { expectTypeOf } from "vitest";

import type { EntityId } from "../../src/engine/engine-api";
import { defineComponent, Types, type InferComponent } from "../../src/schema";
import { useComponentFor } from "../../src/system/runtime/use-component";
import { useComponent } from "../../src/actor/runtime/use-actor";

const Health = defineComponent({
  name: "Health",
  schema: { current: Types.f32, max: Types.f32 },
});

expectTypeOf<InferComponent<typeof Health>>().toEqualTypeOf<{
  current: number;
  max: number;
}>();

const fromActor = useComponent(Health);
const fromEntity = useComponentFor(0n as EntityId, Health);

expectTypeOf(fromActor).toEqualTypeOf(fromEntity);

fromActor.$set({ current: 1 });
fromEntity.$set({ max: 2 });

fromActor.$set({
  // @ts-expect-error unknown field
  nope: 1,
});
