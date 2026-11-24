import { createRealEngine } from "@gwenjs/core/testing";
import type { GwenEngine } from "@gwenjs/core";
import type { GwenErrorPayload, GwenLogEntry, IGwenLogProvider } from "@gwenjs/schema";
import type { PluginConformanceSpec } from "./types.js";

/** One real engine. `events` and `logs` record the error bus and the logger. */
export interface OpenedEngine {
  readonly engine: GwenEngine;
  readonly events: readonly GwenErrorPayload[];
  readonly logs: readonly GwenLogEntry[];
}

/**
 * Boot a real engine for one check and dispose it afterwards.
 * `variant` comes from the spec. When it is absent, the variant is `light`.
 */
export async function withEngine<T>(
  spec: PluginConformanceSpec,
  run: (open: OpenedEngine) => Promise<T>,
): Promise<T> {
  const events: GwenErrorPayload[] = [];
  const logs: GwenLogEntry[] = [];
  const capture: IGwenLogProvider = {
    handle(entry: GwenLogEntry): void {
      logs.push(entry);
    },
  };
  const handle = await createRealEngine({
    variant: spec.variant ?? "light",
    maxEntities: 1024,
    debug: true,
    logger: { providers: [capture], minLevel: "debug" },
  });
  try {
    handle.engine.errors.on((event) => {
      events.push(event);
    });
    return await run({ engine: handle.engine, events, logs });
  } finally {
    await handle.dispose();
  }
}
