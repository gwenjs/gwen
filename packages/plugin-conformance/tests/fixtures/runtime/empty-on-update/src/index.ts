import { defineComponent, Types, useEngine, type GwenEngine } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import type { GwenEngineBase } from "@gwenjs/schema";

const Row = defineComponent({
  name: "empty-row",
  schema: { n: Types.f32 },
});

// Narrow return: define-system keys sit outside GWEN_PLUGIN_KEYS.
const system = defineSystem("EmptySystem", () => {
  const query = useQuery([Row]);
  onUpdate(() => {
    if (query.count !== 0) return;
    useEngine().errors.emit({
      level: "warning",
      code: "FIXTURE:EMPTY",
      message: "empty",
    });
  });
});

export function EmptySystem(): {
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

export function seedRows(engine: GwenEngine): void {
  const id = engine.createEntity();
  engine.addComponent(id, Row, { n: 1 });
}
