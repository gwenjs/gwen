import { vi } from "vitest";

import type { WasmEngine, WasmEntityId } from "../../src/engine/wasm-bridge";

/**
 * Entity and staging exports for a mock that replaced the real bridge.
 * `memory` must be passed to `_injectMockExports` so component writes have a buffer.
 */
export function mockEntitySurface(): {
  memory: WebAssembly.Memory;
  exports: Record<string, unknown>;
} {
  let next = 0;
  const memory = new WebAssembly.Memory({ initial: 1 });
  return {
    memory,
    exports: {
      create_entity(): WasmEntityId {
        const index = next;
        next += 1;
        return { index, generation: 0 };
      },
      delete_entity: () => true,
      is_alive: () => true,
      count_entities: () => next,
      get_entity_generation: () => 0,
      component_staging_ptr: () => 16,
      write_component_staged: () => true,
      read_component_staged: () => false,
      has_component: () => false,
      register_component: () => 1,
      remove_component: () => true,
      set_entity_dormant: () => true,
      is_entity_dormant: () => false,
      storage_generation: () => 0,
    },
  };
}

/** Partial engine stub. Only the methods these unit tests call are real. */
export function createMockWasmEngine(extra: Record<string, unknown> = {}): WasmEngine {
  return {
    create_entity: vi.fn((): WasmEntityId => ({ index: 0, generation: 0 })),
    delete_entity: vi.fn(() => true),
    is_alive: vi.fn(() => true),
    count_entities: vi.fn(() => 0),
    register_component: () => 0,
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
    stats: vi.fn(() => '{"entities":0,"frame":1}'),
    ...extra,
  } as unknown as WasmEngine; // allowlist: WasmEngine requires every export; tests stub only the calls they make #52
}
