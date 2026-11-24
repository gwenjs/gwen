import { defineComponent, Types, type GwenEngine } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import type { GwenEngineBase } from "@gwenjs/schema";

const Spot = defineComponent({
  name: "chunk-spot",
  schema: { x: Types.f32 },
});

// Same narrow return as each-on-update: define-system.ts:285 keys are outside
// GWEN_PLUGIN_KEYS (packages/schema/src/plugin-lifecycle.ts:21).
const system = defineSystem("ChunkSystem", () => {
  const query = useQuery([Spot]);
  onUpdate(() => {
    for (const chunk of query) {
      void chunk.count;
    }
  });
});

export function ChunkSystem(): {
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

export function seedChunk(engine: GwenEngine): void {
  const id = engine.createEntity();
  engine.addComponent(id, Spot, { x: 1 });
}
