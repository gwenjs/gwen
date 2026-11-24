import { defineComponent, Types, type GwenEngine } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import type { GwenEngineBase } from "@gwenjs/schema";

const Spot = defineComponent({
  name: "each-spot",
  schema: { x: Types.f32 },
});

// `_discover`, `_pause`, `_resume` and `_isIsolated` sit on the system object
// (packages/core/src/system/runtime/define-system.ts:285) and are outside
// GWEN_PLUGIN_KEYS (packages/schema/src/plugin-lifecycle.ts:21). The factory
// returns name, setup and teardown. setup still runs the system.
const system = defineSystem("EachSystem", () => {
  const query = useQuery([Spot]);
  onUpdate(() => {
    for (const row of query.each()) {
      row.get(Spot);
    }
  });
});

export function EachSystem(): {
  name: string;
  setup: (engine: GwenEngineBase) => void;
  teardown: () => void;
} {
  const plugin = system();
  return {
    name: plugin.name,
    setup(engine) {
      plugin.setup(engine);
    },
    teardown() {
      plugin.teardown?.();
    },
  };
}

export function seedEach(engine: GwenEngine): void {
  const id = engine.createEntity();
  engine.addComponent(id, Spot, { x: 1 });
}
