import { createHooks } from "hookable";
import { describe, expect, it } from "vitest";

import { DisposableRegistry } from "../../src/disposable";
import { createErrorBus } from "../../src/engine/error-bus";
import { EngineErrorPolicy } from "../../src/engine/engine-error-policy";
import { CoreErrorCodes, GwenWasmPanicError } from "../../src/engine/engine-errors";
import { EngineStateMachine } from "../../src/engine/engine-state";
import type { GwenPlugin } from "../../src/engine/engine-types";
import type { GwenRuntimeHooks } from "../../src/engine/runtime-hooks";
import { createEngine, GwenEngineStateError } from "../../src/index.js";
import { GwenLogger } from "../../src/logger/gwen-logger";
import type { GwenErrorPayload, GwenErrorTarget } from "@gwenjs/schema";

const HANDLER_FAILED = `[${CoreErrorCodes.ERROR_HANDLER_FAILED}]`;

function policyPair(debug = false) {
  const hooks = createHooks<GwenRuntimeHooks>();
  const entries: { level: string; message: string }[] = [];
  const logger = new GwenLogger(
    [
      {
        handle: (entry) => {
          entries.push({ level: entry.level, message: entry.message });
        },
      },
    ],
    "debug",
  );
  const state = new EngineStateMachine({
    hooks,
    logger,
    cancelFrame: () => {},
  });
  const bus = createErrorBus({ logger });
  const seen: GwenErrorPayload[] = [];
  bus.on((event) => {
    seen.push(event);
  });
  const disposables = new DisposableRegistry();
  const plugins = new Map<string, GwenPlugin>();
  let frame = 4;
  const policy = new EngineErrorPolicy({
    bus,
    hooks,
    logger,
    state,
    frame: () => frame,
    debug,
    owner: {},
    disposables,
    pluginNamed: (name) => plugins.get(name),
    bridge: {},
  });
  return {
    hooks,
    entries,
    state,
    seen,
    disposables,
    plugins,
    policy,
    setFrame(next: number) {
      frame = next;
    },
  };
}

const moveTarget: GwenErrorTarget = { kind: "system", id: "sys-1", name: "Move" };

/** The hook rejection is logged from a microtask. Drain that queue once. */
async function drainMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("EngineErrorPolicy", () => {
  it("constructs without createEngine and an error target is isolated while a second policy stays empty", () => {
    const first = policyPair();
    const second = policyPair();
    try {
      first.policy.attach();
      second.policy.attach();

      first.policy.publish({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        message: "move failed",
        target: moveTarget,
        context: { hook: "engine:update", phase: "onUpdate" },
      });

      expect(first.policy.isolated()).toEqual([moveTarget]);
      expect(first.policy.reenable("sys-1")).toBe(true);
      expect(first.policy.isolated()).toEqual([]);
      expect(first.policy.reenable("sys-1")).toBe(false);
      expect(second.policy.isolated()).toEqual([]);
      expect(second.state.state).toBe("idle");

      first.policy.publish({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        message: "setup skipped",
        target: moveTarget,
        context: { phase: "setup", hook: "setup" },
      });
      expect(first.policy.isolated()).toEqual([]);

      first.policy.publish({
        level: "warning",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        message: "warn",
        target: moveTarget,
      });
      expect(first.policy.isolated()).toEqual([]);
      expect(second.policy.isolated()).toEqual([]);
    } finally {
      first.disposables.disposeAll();
      second.disposables.disposeAll();
    }
  });

  it("constructs without createEngine and a fatal wasm panic faults with WASM_PANIC before the bus hook", () => {
    const first = policyPair();
    const second = policyPair();
    try {
      first.policy.attach();
      second.policy.attach();
      first.setFrame(9);
      const order: string[] = [];
      first.hooks.hook("engine:state-change", (payload) => {
        order.push(`state:${payload.reason}`);
      });
      first.hooks.hook("engine:error", (payload) => {
        order.push(`error:${payload.code}:${payload.frame ?? "none"}:${payload.level}`);
      });

      first.policy.publish({
        level: "fatal",
        code: CoreErrorCodes.WASM_PANIC,
        message: "trap",
      });

      expect(first.state.state).toBe("faulted");
      expect(order).toEqual(["state:WASM_PANIC", `error:${CoreErrorCodes.WASM_PANIC}:9:fatal`]);
      expect(first.seen.map((event) => event.code)).toEqual([CoreErrorCodes.WASM_PANIC]);
      expect(second.state.state).toBe("idle");

      const secondOrder: string[] = [];
      second.hooks.hook("engine:state-change", (payload) => {
        secondOrder.push(`state:${payload.reason}`);
      });
      second.hooks.hook("engine:error", (payload) => {
        secondOrder.push(`error:${payload.code}:${payload.frame ?? "none"}:${payload.level}`);
      });
      second.policy.publish({
        level: "fatal",
        code: CoreErrorCodes.FRAME_LOOP_ERROR,
        message: "boom",
      });
      expect(secondOrder).toEqual([
        "state:FATAL_ERROR",
        `error:${CoreErrorCodes.FRAME_LOOP_ERROR}:4:fatal`,
      ]);
      expect(second.state.state).toBe("faulted");
      expect(order).toEqual(["state:WASM_PANIC", `error:${CoreErrorCodes.WASM_PANIC}:9:fatal`]);
      expect(first.state.state).toBe("faulted");
    } finally {
      first.disposables.disposeAll();
      second.disposables.disposeAll();
    }
  });

  it("constructs without createEngine and a throwing engine:error hook keeps the fault and logs once", async () => {
    const first = policyPair();
    const second = policyPair();
    try {
      first.policy.attach();
      second.policy.attach();
      first.hooks.hook("engine:error", () => {
        throw new Error("hook-boom");
      });
      second.hooks.hook("engine:error", () => {
        throw "plain";
      });

      first.policy.publish({
        level: "fatal",
        code: CoreErrorCodes.FRAME_LOOP_ERROR,
        message: "frame",
      });
      second.policy.publish({
        level: "error",
        code: CoreErrorCodes.FRAME_LOOP_ERROR,
        message: "other",
      });
      await drainMicrotasks();

      expect(first.state.state).toBe("faulted");
      expect(second.state.state).toBe("idle");
      expect(
        first.entries.filter((entry) => entry.message === `${HANDLER_FAILED} hook-boom`),
      ).toEqual([{ level: "error", message: `${HANDLER_FAILED} hook-boom` }]);
      expect(second.entries.filter((entry) => entry.message === `${HANDLER_FAILED} plain`)).toEqual(
        [{ level: "error", message: `${HANDLER_FAILED} plain` }],
      );
      expect(first.seen.map((event) => event.message)).toEqual(["frame"]);
    } finally {
      first.disposables.disposeAll();
      second.disposables.disposeAll();
    }
  });

  it("constructs without createEngine and dispose stops policy logging until the next attach", () => {
    const { policy, entries, seen, disposables } = policyPair();
    try {
      policy.attach();
      policy.publish({
        level: "error",
        code: CoreErrorCodes.FRAME_LOOP_ERROR,
        message: "one",
      });
      expect(entries.filter((entry) => entry.message === "one")).toEqual([
        { level: "error", message: "one" },
      ]);

      policy.dispose();
      policy.publish({
        level: "error",
        code: CoreErrorCodes.FRAME_LOOP_ERROR,
        message: "two",
      });
      expect(entries.filter((entry) => entry.message === "two")).toEqual([]);
      expect(seen.map((event) => event.message)).toEqual(["one", "two"]);

      policy.attach();
      policy.publish({
        level: "error",
        code: CoreErrorCodes.FRAME_LOOP_ERROR,
        message: "three",
      });
      expect(entries.filter((entry) => entry.message === "three")).toEqual([
        { level: "error", message: "three" },
      ]);
    } finally {
      disposables.disposeAll();
    }
  });

  it("constructs without createEngine and a recovered plugin error publishes nothing", () => {
    const first = policyPair();
    const second = policyPair();
    try {
      const quiet: GwenPlugin = {
        name: "audio",
        setup() {},
        onError(_error, context) {
          context.recover();
        },
      };
      const loud: GwenPlugin = {
        name: "audio",
        setup() {},
        onError() {},
      };
      first.plugins.set("audio", quiet);
      second.plugins.set("audio", loud);
      const target: GwenErrorTarget = { kind: "plugin", id: "audio", name: "audio" };

      first.policy.reportCaught(new Error("handled"), "engine:update", { target });
      expect(first.seen).toEqual([]);
      expect(first.policy.isolated()).toEqual([]);
      expect(first.state.state).toBe("idle");

      second.policy.reportCaught(new Error("y"), "engine:update", { target });
      expect(second.seen.map((event) => event.message)).toEqual(["[audio] onUpdate threw: y"]);
      expect(second.seen.map((event) => event.code)).toEqual([CoreErrorCodes.PLUGIN_RUNTIME_ERROR]);
      expect(second.policy.isolated()).toEqual([target]);
      expect(first.policy.isolated()).toEqual([]);

      const throwing: GwenPlugin = {
        name: "audio",
        setup() {},
        onError() {
          throw new Error("recover-threw");
        },
      };
      first.plugins.set("audio", throwing);
      first.policy.reportCaught(new Error("z"), "engine:update", { target });
      expect(first.seen.map((event) => event.message)).toEqual(["[audio] onUpdate threw: z"]);
      expect(
        first.entries.filter((entry) => entry.message === `${HANDLER_FAILED} recover-threw`),
      ).toEqual([{ level: "error", message: `${HANDLER_FAILED} recover-threw` }]);
      expect(second.policy.isolated()).toEqual([target]);
    } finally {
      first.disposables.disposeAll();
      second.disposables.disposeAll();
    }
  });

  it("constructs without createEngine and a second wasm panic without an export name is dropped", () => {
    const first = policyPair();
    const second = policyPair();
    try {
      first.policy.reportCaught(new WebAssembly.RuntimeError("panic"), "frame");
      expect(first.state.state).toBe("faulted");
      expect(
        first.seen.map((event) => ({
          level: event.level,
          code: event.code,
          message: event.message,
        })),
      ).toEqual([{ level: "fatal", code: CoreErrorCodes.WASM_PANIC, message: "panic" }]);

      first.policy.reportCaught(
        new GwenWasmPanicError(undefined, new WebAssembly.RuntimeError("again")),
        "frame",
      );
      expect(first.seen).toHaveLength(1);
      expect(first.state.state).toBe("faulted");

      second.policy.reportCaught(new WebAssembly.RuntimeError("other"), "frame");
      expect(second.seen.map((event) => event.message)).toEqual(["other"]);
      expect(second.state.state).toBe("faulted");
      expect(first.seen).toHaveLength(1);
    } finally {
      first.disposables.disposeAll();
      second.disposables.disposeAll();
    }
  });

  it("constructs without createEngine and debug isolation warns with the reenable sentence", () => {
    const debug = policyPair(true);
    const quiet = policyPair(false);
    try {
      debug.policy.attach();
      quiet.policy.attach();
      const event = {
        level: "error" as const,
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        message: "isolated",
        target: moveTarget,
        context: { hook: "engine:update" },
      };
      debug.policy.publish(event);
      quiet.policy.publish(event);
      const warning = `[GWEN] system "Move" isolated after ${CoreErrorCodes.PLUGIN_RUNTIME_ERROR} in engine:update; skipped until engine.reenable("sys-1").`;
      const debugWarnings = debug.entries.filter((entry) => entry.level === "warn");
      const quietWarnings = quiet.entries.filter((entry) => entry.level === "warn");
      if (__GWEN_DEV__) {
        expect(debugWarnings).toEqual([{ level: "warn", message: warning }]);
      } else {
        expect(debugWarnings).toEqual([]);
      }
      expect(quietWarnings).toEqual([]);
      expect(debug.policy.isolated()).toEqual([moveTarget]);
      expect(quiet.policy.isolated()).toEqual([moveTarget]);
    } finally {
      debug.disposables.disposeAll();
      quiet.disposables.disposeAll();
    }
  });

  it("createEngine stop then a new start isolates only the new engine", async () => {
    const first = await createEngine();
    const second = await createEngine();
    try {
      await first.startExternal();
      first.errors.emit({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        message: "first-hit",
        target: moveTarget,
      });
      expect(first.isolated()).toEqual([moveTarget]);

      await first.stop();
      expect(first.state).toBe("stopped");
      expect(first.isolated()).toEqual([]);

      let caught: unknown;
      try {
        await first.start();
      } catch (error) {
        caught = error;
      }
      if (!(caught instanceof GwenEngineStateError)) throw caught;
      expect(caught.message).toBe(
        "[GwenEngine] start() is not allowed while the engine is stopped.",
      );
      expect(first.state).toBe("stopped");

      await second.startExternal();
      second.errors.emit({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        message: "second-hit",
        target: moveTarget,
      });
      expect(second.state).toBe("running");
      expect(second.isolated()).toEqual([moveTarget]);
      expect(first.isolated()).toEqual([]);
      expect(first.state).toBe("stopped");
    } finally {
      if (second.state !== "stopped") await second.stop();
      if (first.state !== "stopped") await first.stop();
    }
  });
});
