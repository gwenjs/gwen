import { expectTypeOf } from "vitest";

import { defineComponent, Types } from "../../src/schema";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { useActor } from "../../src/actor/runtime/use-actor";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
});

const prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

const bare = defineActor(prefab, () => ({
  ping(): number {
    return 1;
  },
}));
const namedBare = defineActor("bare", prefab, () => ({
  ping(): number {
    return 1;
  },
}));
const withProps = defineActor(prefab, (props: { hp: number }) => ({ hp: props.hp }));
const namedProps = defineActor("props", prefab, (props: { hp: number }) => ({ hp: props.hp }));

const bareHandle = useActor(bare);
bareHandle.spawn();
expectTypeOf(bareHandle.ping()).toEqualTypeOf<number>();
// @ts-expect-error no-props actor takes no argument
bareHandle.spawn({});

const namedBareHandle = useActor(namedBare);
namedBareHandle.spawn();

const propsHandle = useActor(withProps);
propsHandle.spawn({ hp: 3 });
expectTypeOf(propsHandle.hp).toEqualTypeOf<number>();
// @ts-expect-error props are required
propsHandle.spawn();

const namedPropsHandle = useActor(namedProps);
namedPropsHandle.spawn({ hp: 4 });

const voidActor = defineActor(prefab, () => undefined);
useActor(voidActor).spawn();

defineActor(
  prefab,
  // @ts-expect-error unannotated props fail under noImplicitAny
  (props) => ({ props }),
);
