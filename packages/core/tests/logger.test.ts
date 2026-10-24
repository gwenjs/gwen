/**
 * createLogger(tag, options?) delivers through providers.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createEngine, createLogger } from "../src/index";
import type { GwenLogEntry } from "@gwenjs/schema";

function silenceConsole() {
  return {
    debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

function capture(): {
  seen: GwenLogEntry[];
  provider: { handle(entry: GwenLogEntry): void };
} {
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

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createLogger drops debug and info by default", () => {
    const spies = silenceConsole();
    const logger = createLogger("x");
    logger.debug("debug-line");
    logger.info("info-line");
    logger.warn("warn-line");
    logger.error("error-line");

    expect(spies.warn).toHaveBeenCalledWith("[x]", "warn-line");
    expect(spies.error).toHaveBeenCalledWith("[x]", "error-line");
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
  });

  it("createLogger with minLevel debug delivers all levels", () => {
    const spies = silenceConsole();
    const logger = createLogger("x", { minLevel: "debug" });
    logger.debug("debug-line");
    logger.info("info-line");
    logger.warn("warn-line");
    logger.error("error-line");

    expect(spies.debug).toHaveBeenCalledWith("[x]", "debug-line");
    expect(spies.info).toHaveBeenCalledWith("[x]", "info-line");
    expect(spies.warn).toHaveBeenCalledWith("[x]", "warn-line");
    expect(spies.error).toHaveBeenCalledWith("[x]", "error-line");
  });

  it("createLogger uses the given providers", () => {
    const spies = silenceConsole();
    const { seen, provider } = capture();
    createLogger("x", { providers: [provider] }).warn("hello");

    expect(seen.map((entry) => entry.tag)).toEqual(["x"]);
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
  });

  it("an empty providers array delivers nothing", () => {
    const spies = silenceConsole();
    const logger = createLogger("x", { providers: [] });
    logger.debug("debug-line");
    logger.info("info-line");
    logger.warn("warn-line");
    logger.error("error-line");

    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
  });

  it("child shares providers and minimum level", () => {
    const { seen, provider } = capture();
    const child = createLogger("x", { minLevel: "error", providers: [provider] }).child("c", "e1");
    child.warn("dropped");
    child.error("kept");

    expect(
      seen.map((entry) => ({
        level: entry.level,
        tag: entry.tag,
        entityId: entry.entityId,
        message: entry.message,
      })),
    ).toEqual([{ level: "error", tag: "c", entityId: "e1", message: "kept" }]);
  });

  it("frame is present when a getter is set and absent otherwise", () => {
    const framed = capture();
    const plain = capture();
    createLogger("x", { providers: [framed.provider], getFrame: () => 4 }).warn("with-frame");
    createLogger("x", { providers: [plain.provider] }).warn("without-frame");
    const plainEntry = plain.seen[0];

    expect([framed.seen[0]?.frame, plainEntry !== undefined && !("frame" in plainEntry)]).toEqual([
      4,
      true,
    ]);
  });

  it("a frame of 0 is kept", () => {
    const { seen, provider } = capture();
    createLogger("x", { providers: [provider], getFrame: () => 0 }).warn("zero");
    expect(seen[0]?.frame).toBe(0);
  });

  it("two loggers do not cross-deliver", () => {
    const left = capture();
    const right = capture();
    createLogger("a", { providers: [left.provider] }).warn("from-a");
    createLogger("b", { providers: [right.provider] }).error("from-b");

    expect([
      left.seen.map((entry) => entry.message),
      right.seen.map((entry) => entry.message),
    ]).toEqual([["from-a"], ["from-b"]]);
  });
});

describe("GwenLogger", () => {
  describe("engine.logger integration", () => {
    function capturing(): {
      seen: GwenLogEntry[];
      logger: { providers: [{ handle(entry: GwenLogEntry): void }] };
    } {
      const seen: GwenLogEntry[] = [];
      return {
        seen,
        logger: {
          providers: [
            {
              handle(entry) {
                seen.push(entry);
              },
            },
          ],
        },
      };
    }

    it("engine.logger is available after createEngine()", async () => {
      const engine = await createEngine();
      try {
        expect(engine.logger).toBeDefined();
        expect(typeof engine.logger.debug).toBe("function");
        expect(typeof engine.logger.child).toBe("function");
      } finally {
        await engine.stop();
      }
    });

    it("engine.logger.child() produces a scoped logger", async () => {
      const { seen, logger } = capturing();
      const engine = await createEngine({ debug: true, logger });
      try {
        const child = engine.logger.child("@gwenjs/test-plugin");
        child.warn("child message");

        expect(seen).toHaveLength(1);
        expect(seen[0]!.tag).toBe("@gwenjs/test-plugin");
      } finally {
        await engine.stop();
      }
    });

    it("debug mode off: engine.logger.debug() is silent", async () => {
      const { seen, logger } = capturing();
      const engine = await createEngine({ debug: false, logger });
      try {
        engine.logger.debug("this should be silent");
        engine.logger.info("this too");

        expect(seen).toEqual([]);
      } finally {
        await engine.stop();
      }
    });

    it("debug mode on: engine.logger.debug() reaches the sink", async () => {
      const { seen, logger } = capturing();
      const engine = await createEngine({ debug: true, logger });
      try {
        engine.logger.debug("visible in debug mode");

        expect(seen).toHaveLength(1);
        expect(seen[0]!.message).toBe("visible in debug mode");
      } finally {
        await engine.stop();
      }
    });
  });
});
