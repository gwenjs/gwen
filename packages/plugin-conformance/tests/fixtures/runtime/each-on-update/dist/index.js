import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Spot = defineComponent({
  name: "each-spot",
  schema: { x: Types.f32 },
});

// Twin of src/index.ts. Keys outside GWEN_PLUGIN_KEYS are left off the return.
const system = defineSystem("EachSystem", () => {
  const query = useQuery([Spot]);
  onUpdate(() => {
    for (const row of query.each()) {
      row.get(Spot);
    }
  });
});

export function EachSystem() {
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

export function seedEach(engine) {
  const id = engine.createEntity();
  engine.addComponent(id, Spot, { x: 1 });
}
