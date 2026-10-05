import { expectTypeOf } from "vitest";

import { defineComponent, Types } from "../../src/schema";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { useActor } from "../../src/actor/runtime/use-actor";
import { defineActorPool } from "../../src/actor/runtime/pool/define-actor-pool";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32 },
});

const prefab = definePrefab([{ def: Position, defaults: { x: 0 } }]);

const withProps = defineActor(prefab, (props: { hp: number }) => ({ hp: props.hp }));
const bare = defineActor(prefab, () => ({ ok: true }));

const propsPool = defineActorPool(withProps, { size: 2 });
const barePool = defineActorPool(bare, { size: 2 });

expectTypeOf(propsPool.acquire).toEqualTypeOf(useActor(withProps).spawn);
expectTypeOf(barePool.acquire).toEqualTypeOf(useActor(bare).spawn);

propsPool.acquire({ hp: 1 });
// @ts-expect-error props are required
propsPool.acquire();

barePool.acquire();
// @ts-expect-error no-props pool takes no argument
barePool.acquire({ hp: 1 });
