import { defineComponent, Types } from "../../src/schema";

/** Component with numeric `x` and `y`, for tests that used a name-only stand-in. */
export function stubComponent(name: string) {
  return defineComponent({
    name,
    schema: { x: Types.f32, y: Types.f32 },
  });
}

/** Component with a numeric `value` field. */
export function stubValue(name: string) {
  return defineComponent({
    name,
    schema: { value: Types.f32 },
  });
}

/** Component with a numeric `hp` field. */
export function stubHealth(name: string) {
  return defineComponent({
    name,
    schema: { hp: Types.f32 },
  });
}
