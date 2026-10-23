import { describe, it, expect } from "vitest";
import { GwenLogger } from "../../src/logger/gwen-logger";
import { consoleLogProvider } from "../../src/logger/console-log-provider";
import type { IGwenLogProvider, GwenLogEntry } from "@gwenjs/schema";

function makeProvider(): { entries: GwenLogEntry[]; provider: IGwenLogProvider } {
  const entries: GwenLogEntry[] = [];
  return { entries, provider: { handle: (e) => entries.push(e) } };
}

describe("GwenLogger", () => {
  it("emits entries to all providers", () => {
    const p1 = makeProvider();
    const p2 = makeProvider();
    const log = new GwenLogger([p1.provider, p2.provider], "debug");
    log.info("hello");
    expect(p1.entries).toHaveLength(1);
    expect(p2.entries).toHaveLength(1);
  });

  it("filters entries below minLevel", () => {
    const { entries, provider } = makeProvider();
    const log = new GwenLogger([provider], "warn");
    log.debug("ignored");
    log.info("ignored");
    log.warn("kept");
    log.error("kept");
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.level)).toEqual(["warn", "error"]);
  });

  it("includes tag and entityId in child logger entries", () => {
    const { entries, provider } = makeProvider();
    const log = new GwenLogger([provider], "debug");
    const child = log.child("actor:Player", "42");
    child.info("spawned");
    expect(entries[0]!.tag).toBe("actor:Player");
    expect(entries[0]!.entityId).toBe("42");
  });

  it("includes payload in entries", () => {
    const { entries, provider } = makeProvider();
    const log = new GwenLogger([provider], "debug");
    log.warn("low hp", { hp: 5 });
    expect(entries[0]!.payload).toEqual({ hp: 5 });
  });

  it("includes a timestamp", () => {
    const { entries, provider } = makeProvider();
    const log = new GwenLogger([provider], "debug");
    log.info("test");
    expect(typeof entries[0]!.timestamp).toBe("number");
  });

  it("child shares providers, minimum level and frame getter", () => {
    const seen: GwenLogEntry[] = [];
    const capture = {
      handle(entry: GwenLogEntry) {
        seen.push(entry);
      },
    };
    const frame = 4;
    const parent = new GwenLogger([capture], "warn", "parent", undefined, () => frame);
    const child = parent.child("child:tag");
    child.debug("dropped");
    child.warn("kept");
    expect(
      seen.map((entry) => ({
        level: entry.level,
        message: entry.message,
        tag: entry.tag,
        frame: entry.frame,
      })),
    ).toEqual([{ level: "warn", message: "kept", tag: "child:tag", frame: 4 }]);
  });

  it("frame is present when a getter is set and absent otherwise", () => {
    const present = makeProvider();
    const withGetter = new GwenLogger([present.provider], "debug", "tag", undefined, () => 4);
    withGetter.warn("present");
    const absent = makeProvider();
    const withoutGetter = new GwenLogger([absent.provider], "debug", "tag");
    withoutGetter.warn("absent");
    const absentEntry = absent.entries[0];
    expect([
      present.entries[0]?.frame,
      absentEntry !== undefined && "frame" in absentEntry,
    ]).toEqual([4, false]);
  });

  it("a frame of 0 is kept", () => {
    const { entries, provider } = makeProvider();
    const log = new GwenLogger([provider], "warn", "tag", undefined, () => 0);
    log.warn("zero");
    expect(entries[0]?.frame).toBe(0);
  });
});

function consoleWarnCalls(run: () => void): unknown[][] {
  const calls: unknown[][] = [];
  const previous = console.warn;
  console.warn = (...args) => {
    calls.push(args);
  };
  try {
    run();
  } finally {
    console.warn = previous;
  }
  return calls;
}

function argsInclude(calls: unknown[][], text: string): boolean {
  return calls.some((args) => args.some((arg) => typeof arg === "string" && arg.includes(text)));
}

describe("consoleLogProvider", () => {
  it("consoleLogProvider prints frame=<n> when frame is defined", () => {
    const provider = consoleLogProvider();
    const withFrame = consoleWarnCalls(() => {
      provider.handle({
        level: "warn",
        message: "with-frame",
        timestamp: 1,
        frame: 0,
      });
    });
    const withoutFrame = consoleWarnCalls(() => {
      provider.handle({
        level: "warn",
        message: "without-frame",
        timestamp: 1,
      });
    });
    expect([argsInclude(withFrame, "frame=0"), argsInclude(withoutFrame, "frame=")]).toEqual([
      true,
      false,
    ]);
  });
});
