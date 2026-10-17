import { expectTypeOf } from "vitest";

import { defineComponent, Types } from "../../src/schema";
import { useQuery } from "../../src/system/runtime/define-system";

const Position = defineComponent({
  name: "QueryChunkPosType",
  schema: { x: Types.f32, y: Types.f32 },
});

const Label = defineComponent({
  name: "QueryChunkLabelType",
  schema: { name: Types.string },
});

const Big = defineComponent({
  name: "QueryChunkBigType",
  schema: { n: Types.i64 },
});

const query = useQuery([Position, Label, Big]);

for (const chunk of query) {
  expectTypeOf(chunk.get(Position).x).toEqualTypeOf<Float32Array>();
  const label = chunk.get(Label);
  expectTypeOf<"name" extends keyof typeof label ? true : false>().toEqualTypeOf<false>();
  const big = chunk.get(Big);
  expectTypeOf<"n" extends keyof typeof big ? true : false>().toEqualTypeOf<false>();
}
