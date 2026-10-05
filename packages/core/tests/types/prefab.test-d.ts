import { defineComponent, Types } from "../../src/schema";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { usePrefab } from "../../src/actor/runtime/use-actor";
import { placeActor, placePrefab } from "../../src/actor/runtime/place";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
});

const Health = defineComponent({
  name: "Health",
  schema: { hp: Types.f32 },
});

const prefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Health, defaults: { hp: 1 } },
]);

definePrefab([
  {
    def: Position,
    defaults: {
      x: 0,
      y: 0,
      // @ts-expect-error unknown field
      z: 1,
    },
  },
]);

const handle = usePrefab(prefab);
handle.spawn({ x: 1, hp: 2 });
handle.spawn({
  x: 1,
  // @ts-expect-error unknown field
  nope: 1,
});

placePrefab(prefab, { props: { x: 2, hp: 3 } });
placePrefab(prefab, {
  props: {
    // @ts-expect-error unknown field
    nope: 1,
  },
});

const actor = defineActor(prefab, (props: { hp: number }) => ({ hp: props.hp }));
placeActor(actor, { props: { hp: 4 } });
placeActor(actor, {
  props: {
    // @ts-expect-error wrong props
    hp: "x",
  },
});
