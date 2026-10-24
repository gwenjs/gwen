/**
 * @file `useLogger` logs through the engine configured in `createEngine` (P-272-2).
 */

import { describe, expect, it } from "vitest";
import { createEngine, type GwenEngine } from "@gwenjs/core";
import { defineSystem } from "@gwenjs/core/system";
import { GwenContextError, useLogger } from "@gwenjs/kit";
import type { GwenLogEntry, IGwenLogProvider } from "@gwenjs/schema";

function captureProvider(): { seen: GwenLogEntry[]; provider: IGwenLogProvider } {
  const seen: GwenLogEntry[] = [];
  return {
    seen,
    provider: {
      handle(entry) {
        seen.push(entry);
      },
    },
  };
}

async function withEngine(
  provider: IGwenLogProvider,
  body: (engine: GwenEngine) => Promise<void>,
): Promise<void> {
  const engine = await createEngine({
    logger: { providers: [provider], minLevel: "debug" },
  });
  try {
    await body(engine);
  } finally {
    await engine.stop();
  }
}

describe("useLogger on a real engine", () => {
  it("useLogger in a system factory logs through the configured provider with tag system:<name>", async () => {
    const { seen, provider } = captureProvider();
    await withEngine(provider, async (engine) => {
      await engine.use(
        defineSystem("Mover", () => {
          useLogger().info("hi");
        })(),
      );
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ level: "info", message: "hi", tag: "system:Mover" });
  });

  it("useLogger in two engines logs to each engine's own provider", async () => {
    const first = captureProvider();
    const second = captureProvider();
    const engineA = await createEngine({
      logger: { providers: [first.provider], minLevel: "debug" },
    });
    try {
      const engineB = await createEngine({
        logger: { providers: [second.provider], minLevel: "debug" },
      });
      try {
        await engineA.use(
          defineSystem("MoverA", () => {
            useLogger().info("from-a");
          })(),
        );
        await engineB.use(
          defineSystem("MoverB", () => {
            useLogger().info("from-b");
          })(),
        );
      } finally {
        await engineB.stop();
      }
    } finally {
      await engineA.stop();
    }
    expect(first.seen.map((entry) => entry.message)).toEqual(["from-a"]);
    expect(second.seen.map((entry) => entry.message)).toEqual(["from-b"]);
  });

  it("useLogger throws again once the system factory has returned", async () => {
    const { provider } = captureProvider();
    await withEngine(provider, async (engine) => {
      await engine.use(
        defineSystem("Mover", () => {
          useLogger().info("inside");
        })(),
      );
      let thrown: unknown;
      try {
        useLogger();
      } catch (error) {
        thrown = error;
      }
      expect(thrown instanceof GwenContextError).toBe(true);
      if (!(thrown instanceof GwenContextError)) return;
      expect(thrown.code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
    });
  });
});
