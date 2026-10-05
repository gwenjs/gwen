import { expectTypeOf } from "vitest";

import { defineComponent, Types, type InferComponent } from "../../src/schema";
import { useQuery } from "../../src/system/runtime/define-system";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
});

const Health = defineComponent({
  name: "Health",
  schema: { hp: Types.f32 },
});

const query = useQuery([Position]);

for (const entity of query) {
  expectTypeOf(entity.get(Position)).toEqualTypeOf<InferComponent<typeof Position>>();
  // @ts-expect-error unqueried component is a compile error
  entity.get(Health);
}
