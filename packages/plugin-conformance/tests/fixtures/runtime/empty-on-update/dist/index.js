import { defineComponent, Types, useEngine } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

// Twin of src/index.ts. Warns on engine:update only while the query has 0 rows.
const Row = defineComponent({
  name: "empty-row",
  schema: { n: Types.f32 },
});

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

export function EmptySystem() {
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

export function seedRows(engine) {
  const id = engine.createEntity();
  engine.addComponent(id, Row, { n: 1 });
}
