/**
 * @file Dev record of who called `useService` for which key, so a swap of the plugin that
 * provides the key can run those readers again. Dev only: `useService` writes it under
 * `__GWEN_DEV__`; a production build never reaches this module.
 *
 * @module
 */

import { GwenScope } from "../context/scope.js";
import { useEngine } from "../engine/context";
import { createEngineLocal } from "../engine/engine-local.js";
import type { GwenEngine } from "../engine/engine-types.js";

/** One scope that read a service. The id is the scope id, so a swapped body keeps its entry. */
export interface ServiceReader {
  readonly id: string;
  readonly type: GwenScope["meta"]["type"];
  /** Scope name, or the scope id when it has none. */
  readonly name: string;
  readonly entityId?: bigint;
}

/** Service key to readers by scope id, in first-read order within that key. Released by `stop()`. */
const readers = createEngineLocal<Map<string, Map<string, ServiceReader>>>(() => new Map());

/** Record that the scope now running read `key`. The entry leaves with the scope. */
export function noteServiceReader(key: string): void {
  const scope = GwenScope.current();
  if (scope === null) return;
  const byKey = readers.get(useEngine("useService"));
  let ids = byKey.get(key);
  if (ids === undefined) {
    ids = new Map();
    byKey.set(key, ids);
  }
  const { id, type, entityId } = scope.meta;
  const name = scope.meta.name ?? id;
  const own = ids;
  own.set(id, entityId === undefined ? { id, type, name } : { id, type, name, entityId });
  scope.onCleanup(() => {
    own.delete(id);
  });
}

/** Readers of any of `keys` on `engine`, each once, by key, then in first-read order. */
export function readersOf(engine: GwenEngine, keys: readonly string[]): ServiceReader[] {
  const byKey = readers.peek(engine);
  const found = new Map<string, ServiceReader>();
  if (byKey === undefined) return [];
  for (const key of keys) {
    for (const [id, reader] of byKey.get(key) ?? []) found.set(id, reader);
  }
  return Array.from(found.values());
}
