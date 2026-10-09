import { vi } from "vitest";

import type { WasmEngine, WasmEntityId } from "../../src/engine/wasm-bridge";

/** Partial engine stub. Only the methods these unit tests call are real. */
export function createMockWasmEngine(): WasmEngine {
  return {
    create_entity: vi.fn((): WasmEntityId => ({ index: 0, generation: 0 })),
    delete_entity: vi.fn(() => true),
    is_alive: vi.fn(() => true),
    count_entities: vi.fn(() => 0),
    register_component_type: vi.fn(() => 0),
    add_component: vi.fn(() => true),
    remove_component: vi.fn(() => true),
    has_component: vi.fn(() => false),
    get_component_raw: vi.fn(() => new Uint8Array(0)),
    update_entity_archetype: vi.fn(),
    remove_entity_from_query: vi.fn(),
    query_entities: vi.fn(() => new Uint32Array(0)),
    query_entities_to_buffer: vi.fn(() => 0),
    get_query_result_ptr: vi.fn(() => 8192),
    get_query_result_capacity: vi.fn(() => 10_000),
    get_entity_generation: vi.fn(() => 0),
    alloc_shared_buffer: vi.fn(() => 4096),
    sync_transforms_to_buffer: vi.fn(),
    sync_transforms_to_buffer_sparse: vi.fn(),
    dirty_transform_count: vi.fn(() => 0),
    clear_transform_dirty: vi.fn(),
    sync_transforms_from_buffer: vi.fn(),
    stats: vi.fn(() => '{"entities":0,"frame":1}'),
  } as unknown as WasmEngine; // allowlist: WasmEngine requires every export; tests stub only the calls they make #52
}
