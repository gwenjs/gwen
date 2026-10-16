import type { GwenEngine } from "../../src/engine/engine-types";

/** Marks the per-engine bridge active so `start()` can schedule frames. */
export function activateTestWasm(engine: GwenEngine): void {
  let next = 0;
  const memory = new WebAssembly.Memory({ initial: 1 });
  const bridge = engine.inject("wasm:bridge");
  bridge._injectMock({
    register_component: (_laneKinds: Uint8Array) => next++,
    count_entities: () => 0,
    create_entity: () => ({ index: next++, generation: 0 }),
    delete_entity: () => true,
    is_alive: () => true,
    storage_generation: () => 0,
    component_staging_ptr: () => 16,
    write_component_staged: () => true,
    read_component_staged: () => false,
    has_component: () => false,
    set_entity_dormant: () => true,
    is_entity_dormant: () => false,
    remove_component: () => true,
  } as never);
  bridge._injectMockExports({ memory });
}
