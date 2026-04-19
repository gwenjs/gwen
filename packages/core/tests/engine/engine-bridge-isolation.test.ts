import { describe, it, expect } from "vitest";
import { createEngine } from "../../src/engine/gwen-engine";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge";
import type { WasmEngine, WasmEntityId } from "../../src/engine/wasm-bridge";
import { vi } from "vitest";

function makeMock(entityCount = 0): WasmEngine {
  return {
    create_entity: vi.fn((): WasmEntityId => ({ index: 0, generation: 0 })),
    count_entities: vi.fn(() => entityCount),
    delete_entity: vi.fn(() => true),
    is_alive: vi.fn(() => true),
    register_component_type: vi.fn(() => 0),
    add_component: vi.fn(() => true),
    remove_component: vi.fn(() => true),
    has_component: vi.fn(() => false),
    get_component_raw: vi.fn(() => new Uint8Array(0)),
    get_components_bulk: vi.fn(() => 0),
    set_components_bulk: vi.fn(),
    update_entity_archetype: vi.fn(),
    remove_entity_from_query: vi.fn(),
    query_entities: vi.fn(() => new Uint32Array(0)),
    query_entities_to_buffer: vi.fn(() => 0),
    get_query_result_ptr: vi.fn(() => 0),
    get_entity_generation: vi.fn(() => 0),
    query_read_bulk: vi.fn(() => new Uint32Array([0, 0])),
    query_write_bulk: vi.fn(),
    update_transforms: vi.fn(),
    add_entity_transform: vi.fn(),
    set_entity_parent: vi.fn(),
    translate_entity: vi.fn(),
    set_entity_local_position: vi.fn(),
    set_entity_local_rotation: vi.fn(),
    set_entity_local_scale: vi.fn(),
    get_entity_local_x: vi.fn(() => 0),
    get_entity_local_y: vi.fn(() => 0),
    get_entity_world_x: vi.fn(() => 0),
    get_entity_world_y: vi.fn(() => 0),
    get_entity_world_rotation: vi.fn(() => 0),
    get_entity_local_rotation: vi.fn(() => 0),
    has_entity_parent: vi.fn(() => false),
    bulk_destroy: vi.fn(),
    bulk_spawn_with_transforms: vi.fn(() => new Uint32Array(0)),
    tick: vi.fn(),
    frame_count: vi.fn(() => 0n),
    delta_time: vi.fn(() => 0),
    total_time: vi.fn(() => 0),
    alloc_shared_buffer: vi.fn(() => 0),
    free_shared_buffer: vi.fn(),
    sync_transforms_to_buffer: vi.fn(),
    sync_transforms_to_buffer_sparse: vi.fn(),
    dirty_transform_count: vi.fn(() => 0),
    clear_transform_dirty: vi.fn(),
    sync_transforms_from_buffer: vi.fn(),
    stats: vi.fn(() => "{}"),
  } as unknown as WasmEngine;
}

describe("GwenEngine — per-engine bridge isolation", () => {
  it("two engines created with separate bridges are independent", async () => {
    const mockA = makeMock(5);
    const mockB = makeMock(99);
    const bridgeA = new WasmBridgeImpl();
    const bridgeB = new WasmBridgeImpl();
    bridgeA._injectMock(mockA);
    bridgeB._injectMock(mockB);

    const engineA = await createEngine({ _bridge: bridgeA });
    const engineB = await createEngine({ _bridge: bridgeB });

    // Exercise engineA — advance one frame so _runFrame routes through bridgeA
    // Phase 5 of _runFrame calls this._bridge.engine().update_transforms?.()
    await engineA.advance(1 / 60);

    // bridgeA's update_transforms was called; bridgeB's was not touched
    expect(mockA.update_transforms).toHaveBeenCalled();
    expect(mockB.update_transforms).not.toHaveBeenCalled();

    // Entity counts remain as injected — bridges are fully isolated
    expect(bridgeA.countEntities()).toBe(5);
    expect(bridgeB.countEntities()).toBe(99);

    await engineA.stop();
    await engineB.stop();
  });

  it("engine provides its bridge via inject", async () => {
    const bridge = new WasmBridgeImpl();
    bridge._injectMock(makeMock());
    const engine = await createEngine({ _bridge: bridge });

    const injected = engine.tryInject("wasm:bridge");
    expect(injected).toBe(bridge);

    await engine.stop();
  });
});
