import { describe, it, expect, vi } from "vitest";
import { WasmBridgeImpl } from "../src/engine/wasm-bridge";
import type { WasmEngine, WasmEntityId } from "../src/engine/wasm-bridge";

function makeMock(): WasmEngine {
  return {
    create_entity: vi.fn((): WasmEntityId => ({ index: 1, generation: 0 })),
    count_entities: vi.fn(() => 42),
    delete_entity: vi.fn(() => true),
    is_alive: vi.fn(() => true),
    register_component_type: vi.fn(() => 0),
    add_component: vi.fn(() => true),
    remove_component: vi.fn(() => true),
    has_component: vi.fn(() => false),
    get_component_raw: vi.fn(() => new Uint8Array(0)),
    update_entity_archetype: vi.fn(),
    remove_entity_from_query: vi.fn(),
    query_entities: vi.fn(() => new Uint32Array(0)),
    query_entities_to_buffer: vi.fn(() => 0),
    get_query_result_ptr: vi.fn(() => 0),
    get_entity_generation: vi.fn(() => 0),
    get_components_bulk: vi.fn(() => 0),
    set_components_bulk: vi.fn(),
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

describe("WasmBridgeImpl — per-instance isolation", () => {
  it("two instances are independent — injecting mock on one does not affect the other", () => {
    const bridgeA = new WasmBridgeImpl();
    const bridgeB = new WasmBridgeImpl();

    bridgeA._injectMock(makeMock());

    expect(bridgeA.isActive()).toBe(true);
    expect(bridgeB.isActive()).toBe(false);
  });

  it("resetting one bridge does not affect the other", () => {
    const bridgeA = new WasmBridgeImpl();
    const bridgeB = new WasmBridgeImpl();

    bridgeA._injectMock(makeMock());
    bridgeB._injectMock(makeMock());

    bridgeA._reset();

    expect(bridgeA.isActive()).toBe(false);
    expect(bridgeB.isActive()).toBe(true);
  });

  it("countEntities delegates to the instance mock, not a shared engine", () => {
    const mockA = makeMock();
    const mockB = makeMock();
    (mockA.count_entities as ReturnType<typeof vi.fn>).mockReturnValue(10);
    (mockB.count_entities as ReturnType<typeof vi.fn>).mockReturnValue(99);

    const bridgeA = new WasmBridgeImpl();
    const bridgeB = new WasmBridgeImpl();
    bridgeA._injectMock(mockA);
    bridgeB._injectMock(mockB);

    expect(bridgeA.countEntities()).toBe(10);
    expect(bridgeB.countEntities()).toBe(99);
  });

  it("_injectMockExports on one bridge does not affect the other", () => {
    const bridgeA = new WasmBridgeImpl();
    const bridgeB = new WasmBridgeImpl();

    const fakeMemory = { buffer: new ArrayBuffer(100) } as unknown as WebAssembly.Memory;
    bridgeA._injectMockExports({ memory: fakeMemory });

    expect(bridgeA.getLinearMemory()).toBe(fakeMemory);
    expect(bridgeB.getLinearMemory()).toBeNull();
  });
});
