import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Spot = defineComponent({
  name: "chunk-spot",
  schema: { x: Types.f32 },
});

// Twin of src/index.ts. The loop is the chunk form, not query.each().
const system = defineSystem("ChunkSystem", () => {
  const query = useQuery([Spot]);
  onUpdate(() => {
    for (const chunk of query) {
      void chunk.count;
    }
  });
});

export function ChunkSystem() {
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

export function seedChunk(engine) {
  const id = engine.createEntity();
  engine.addComponent(id, Spot, { x: 1 });
}
