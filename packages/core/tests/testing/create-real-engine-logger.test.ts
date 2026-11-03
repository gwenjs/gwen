import type { GwenLogEntry, IGwenLogProvider } from "@gwenjs/schema";
import { describe, expect, it } from "vitest";
import { createRealEngine, type RealEngineHandle } from "../../src/testing/create-real-engine.js";

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

describe("createRealEngine logger", () => {
  it("forwards logger providers to createEngine", async () => {
    const { seen, provider } = captureProvider();
    let handle: RealEngineHandle | undefined;
    try {
      handle = await createRealEngine({
        variant: "light",
        maxEntities: 4,
        logger: { providers: [provider], minLevel: "debug" },
      });
      handle.engine.inject("logger").info("ping");
      const pings = seen.filter((entry) => entry.message === "ping");
      expect(pings).toHaveLength(1);
      expect(pings[0]?.level).toBe("info");
    } finally {
      await handle?.dispose();
    }
  });

  it("forwards logger minLevel", async () => {
    const { seen, provider } = captureProvider();
    let handle: RealEngineHandle | undefined;
    try {
      handle = await createRealEngine({
        variant: "light",
        maxEntities: 4,
        logger: { providers: [provider], minLevel: "error" },
      });
      const logger = handle.engine.inject("logger");
      logger.error("at");
      logger.warn("below");
      expect(seen.filter((entry) => entry.message === "at")).toHaveLength(1);
      expect(seen.filter((entry) => entry.message === "below")).toHaveLength(0);
    } finally {
      await handle?.dispose();
    }
  });
});
