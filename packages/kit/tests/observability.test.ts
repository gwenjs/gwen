/**
 * @file `useLogger` reads the active scope's engine logger (P-272-2).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  GwenError,
  type GwenEngineBase,
  type GwenScopeMeta,
  type IGwenLogger,
  type IGwenScope,
} from "@gwenjs/schema";
import * as kit from "@gwenjs/kit";

interface Recorded {
  level: string;
  message: string;
  tag: string | undefined;
  entityId: string | undefined;
}

function recordingLogger(entries: Recorded[], tag?: string, entityId?: string): IGwenLogger {
  return {
    debug(message) {
      entries.push({ level: "debug", message, tag, entityId });
    },
    info(message) {
      entries.push({ level: "info", message, tag, entityId });
    },
    warn(message) {
      entries.push({ level: "warn", message, tag, entityId });
    },
    error(message) {
      entries.push({ level: "error", message, tag, entityId });
    },
    child(childTag, childEntityId) {
      return recordingLogger(entries, childTag, childEntityId);
    },
  };
}

function scopeWith(logger: IGwenLogger, meta: GwenScopeMeta): IGwenScope {
  const engine: GwenEngineBase = {
    provide() {},
    inject(): unknown {
      return undefined;
    },
    tryInject(): undefined {
      return undefined;
    },
    hooks: {
      hook() {},
      removeHook() {},
    },
    logger,
    run<T>(fn: () => T): T {
      return fn();
    },
    disposables: {
      add() {},
      disposeAll() {},
      size: 0,
    },
  };
  return {
    meta,
    engine,
    parent: null,
    paused: false,
    hookCount: 0,
    childCount: 0,
    cleanupCount: 0,
    hook() {
      return () => {};
    },
    onCleanup() {},
    run<T>(fn: () => T): T {
      return fn();
    },
    pause() {},
    resume() {},
    dispose() {},
  };
}

function thrownBy(fn: () => void): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

afterEach(() => {
  kit._setCurrentScope(null);
});

describe("useLogger", () => {
  it("useLogger outside a scope names useLogger", () => {
    expect(typeof kit.GwenContextError).toBe("function");
    const thrown = thrownBy(() => {
      kit.useLogger();
    });
    expect(thrown instanceof kit.GwenContextError).toBe(true);
    if (!(thrown instanceof kit.GwenContextError)) return;
    expect(thrown.composable).toBe("useLogger");
  });

  it("useLogger outside a scope throws CORE:OUTSIDE_ENGINE_CONTEXT", () => {
    expect(typeof kit.GwenContextError).toBe("function");
    const thrown = thrownBy(() => {
      kit.useLogger();
    });
    expect(thrown instanceof kit.GwenContextError).toBe(true);
    if (!(thrown instanceof kit.GwenContextError)) return;
    expect(thrown.code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
    expect(thrown.message.length).toBeGreaterThan(0);
  });

  it("useLogger tags the child with <type>:<name>", () => {
    expect(typeof kit.useLogger).toBe("function");
    const entries: Recorded[] = [];
    const logger = recordingLogger(entries);
    kit._setCurrentScope(scopeWith(logger, { type: "actor", id: "actor#1", name: "Hero" }));
    try {
      kit.useLogger().info("ready");
    } finally {
      kit._setCurrentScope(null);
    }
    expect(entries).toEqual([
      { level: "info", message: "ready", tag: "actor:Hero", entityId: undefined },
    ]);
  });

  it("useLogger falls back to the scope id when it has no name", () => {
    expect(typeof kit.useLogger).toBe("function");
    const entries: Recorded[] = [];
    const logger = recordingLogger(entries);
    kit._setCurrentScope(scopeWith(logger, { type: "system", id: "system#4" }));
    try {
      kit.useLogger().info("tick");
    } finally {
      kit._setCurrentScope(null);
    }
    expect(entries).toEqual([
      { level: "info", message: "tick", tag: "system:system#4", entityId: undefined },
    ]);
  });

  it("useLogger passes meta.entityId as a string", () => {
    expect(typeof kit.useLogger).toBe("function");
    const withId: Recorded[] = [];
    kit._setCurrentScope(
      scopeWith(recordingLogger(withId), {
        type: "actor",
        id: "actor#7",
        name: "Hero",
        entityId: 7n,
      }),
    );
    try {
      kit.useLogger().info("spawn");
    } finally {
      kit._setCurrentScope(null);
    }
    expect(withId).toEqual([{ level: "info", message: "spawn", tag: "actor:Hero", entityId: "7" }]);

    const withoutId: Recorded[] = [];
    kit._setCurrentScope(
      scopeWith(recordingLogger(withoutId), { type: "actor", id: "actor#8", name: "Hero" }),
    );
    try {
      kit.useLogger().info("plain");
    } finally {
      kit._setCurrentScope(null);
    }
    expect(withoutId).toEqual([
      { level: "info", message: "plain", tag: "actor:Hero", entityId: undefined },
    ]);
  });
});

describe("useErrorReporter", () => {
  it("useErrorReporter outside a scope throws CORE:OUTSIDE_ENGINE_CONTEXT", () => {
    expect(typeof kit.GwenContextError).toBe("function");
    const thrown = thrownBy(() => {
      kit.useErrorReporter();
    });
    expect(thrown instanceof kit.GwenContextError).toBe(true);
    if (!(thrown instanceof kit.GwenContextError)) return;
    expect(thrown.code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
  });

  it("report throws GwenError and writes no log entry", () => {
    expect(typeof kit.useErrorReporter).toBe("function");
    const entries: Recorded[] = [];
    const cause = new Error("missing");
    kit._setCurrentScope(
      scopeWith(recordingLogger(entries), { type: "system", id: "system#1", name: "Mover" }),
    );
    let thrown: unknown;
    try {
      const reporter: {
        report: (code: `${string}:${string}`, message: string, cause?: unknown) => never;
      } = kit.useErrorReporter();
      thrown = thrownBy(() => {
        reporter.report("KIT:X", "m", cause);
      });
    } finally {
      kit._setCurrentScope(null);
    }
    expect(entries).toEqual([]);
    expect(thrown instanceof GwenError).toBe(true);
    if (!(thrown instanceof GwenError)) return;
    expect(thrown.code).toBe("KIT:X");
    expect(thrown.composable).toBe("useErrorReporter");
    expect(thrown.cause).toBe(cause);
  });
});

describe("usePerfMark", () => {
  it("usePerfMark outside a scope throws CORE:OUTSIDE_ENGINE_CONTEXT", () => {
    expect(typeof kit.GwenContextError).toBe("function");
    const thrown = thrownBy(() => {
      kit.usePerfMark("boot");
    });
    expect(thrown instanceof kit.GwenContextError).toBe(true);
    if (!(thrown instanceof kit.GwenContextError)) return;
    expect(thrown.code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
  });

  it("usePerfMark logs elapsed time on the scope-tagged logger", () => {
    expect(typeof kit.usePerfMark).toBe("function");
    const entries: Recorded[] = [];
    kit._setCurrentScope(
      scopeWith(recordingLogger(entries), { type: "system", id: "system#1", name: "Mover" }),
    );
    try {
      kit.usePerfMark("boot")();
    } finally {
      kit._setCurrentScope(null);
    }
    expect(entries).toEqual([
      { level: "debug", message: "[perf] boot", tag: "system:Mover", entityId: undefined },
    ]);
  });
});
