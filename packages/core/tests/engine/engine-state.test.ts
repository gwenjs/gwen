import { createHooks } from "hookable";
import { describe, expect, it } from "vitest";

import { createDisposable } from "../../src/disposable";
import { EngineStateMachine } from "../../src/engine/engine-state";
import type { EngineStateChangePayload, GwenEngineState } from "../../src/engine/engine-types";
import type { GwenRuntimeHooks } from "../../src/engine/runtime-hooks";
import {
  CoreErrorCodes,
  GwenEngineStateError,
  createEngine,
  type GwenEngine,
} from "../../src/index";
import { GwenLogger as CoreGwenLogger } from "../../src/logger/gwen-logger";
import { activateTestWasm } from "../helpers/activate-test-wasm";
import { GwenError } from "@gwenjs/schema";

type Change = { from: string; to: string; reason: string };

function watch(engine: GwenEngine): Change[] {
  const seen: Change[] = [];
  engine.hooks.hook("engine:state-change", (payload) => {
    seen.push({ from: payload.from, to: payload.to, reason: payload.reason });
  });
  return seen;
}

/**
 * Resolve `true` when `promise` settles within `turns` macrotask turns, `false` otherwise.
 * A bounded wait: a hang shows up as `false` instead of a test timeout.
 */
async function settles(promise: Promise<unknown>, turns = 50): Promise<boolean> {
  let done = false;
  void promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let turn = 0; turn < turns && !done; turn += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  return done;
}

/**
 * Cleanup for `finally`: never throws and never hangs. Calls nothing while `starting`
 * (`stop()` would throw and hide the failure); otherwise a bounded `stop()`.
 */
async function shutdown(engine: GwenEngine): Promise<void> {
  if (engine.state === "starting") return;
  await settles(engine.stop());
}

describe("engine state machine", () => {
  it("orders start and stop hooks around the lifecycle transitions", async () => {
    const engine = await createEngine();
    try {
      const order: string[] = [];
      engine.hooks.hook("engine:state-change", (payload) => {
        order.push(`${payload.from}->${payload.to}:${payload.reason}`);
      });
      engine.hooks.hook("engine:init", () => {
        order.push("init");
      });
      engine.hooks.hook("engine:start", () => {
        order.push("start");
      });
      engine.hooks.hook("engine:stop", () => {
        order.push("stop");
      });

      await engine.startExternal();
      await engine.stop();

      expect(order).toEqual([
        "idle->starting:USER",
        "init",
        "start",
        "starting->running:USER",
        "running->stopping:USER",
        "stop",
        "stopping->stopped:USER",
      ]);
      expect(engine.state).toBe("stopped");
    } finally {
      await shutdown(engine);
    }
  });

  it("start() follows the same order when WASM is active", async () => {
    const engine = await createEngine();
    try {
      const order: string[] = [];
      engine.hooks.hook("engine:state-change", (payload) => {
        order.push(`${payload.from}->${payload.to}`);
      });
      engine.hooks.hook("engine:init", () => {
        order.push("init");
      });
      engine.hooks.hook("engine:start", () => {
        order.push("start");
      });
      activateTestWasm(engine);
      await engine.start();
      expect(order).toEqual(["idle->starting", "init", "start", "starting->running"]);
      expect(engine.state).toBe("running");
      await engine.stop();
    } finally {
      await shutdown(engine);
    }
  });

  it("stop() from idle ends stopped", async () => {
    const engine = await createEngine();
    try {
      const seen = watch(engine);
      await engine.stop();
      expect(engine.state).toBe("stopped");
      expect(seen).toEqual([
        { from: "idle", to: "stopping", reason: "USER" },
        { from: "stopping", to: "stopped", reason: "USER" },
      ]);
      await engine.stop();
      expect(seen).toHaveLength(2);
      expect(engine.state).toBe("stopped");
    } finally {
      await shutdown(engine);
    }
  });

  it("rejects start, advance, and stop while starting", async () => {
    const engine = await createEngine();
    try {
      const rejected: GwenEngineStateError[] = [];
      engine.hooks.hook("engine:state-change", async () => {
        if (engine.state !== "starting") return;
        const calls = [
          engine.start(),
          engine.startExternal(),
          engine.advance(1 / 60),
          engine.stop(),
        ];
        for (const call of calls) {
          const error = await call.then(
            () => undefined,
            (caught: unknown) => caught,
          );
          if (error instanceof GwenEngineStateError) rejected.push(error);
        }
      });
      await engine.startExternal();
      expect(rejected.map((error) => error.method)).toEqual([
        "start",
        "startExternal",
        "advance",
        "stop",
      ]);
      for (const error of rejected) {
        expect(error.code).toBe(CoreErrorCodes.INVALID_STATE_TRANSITION);
        expect(error.from).toBe("starting");
      }
      expect(engine.state).toBe("running");
    } finally {
      await shutdown(engine);
    }
  });

  it("rejects a second start while running and still advances", async () => {
    const engine = await createEngine();
    try {
      const seen = watch(engine);
      await engine.startExternal();
      const busBefore = engine.frameCount;
      await expect(engine.start()).rejects.toMatchObject({
        name: "GwenEngineStateError",
        code: CoreErrorCodes.INVALID_STATE_TRANSITION,
        from: "running",
        method: "start",
      });
      await expect(engine.startExternal()).rejects.toMatchObject({
        from: "running",
        method: "startExternal",
      });
      await engine.advance(1 / 60);
      expect(engine.frameCount).toBe(busBefore + 1);
      expect(engine.state).toBe("running");
      expect(seen).toEqual([
        { from: "idle", to: "starting", reason: "USER" },
        { from: "starting", to: "running", reason: "USER" },
      ]);
    } finally {
      await shutdown(engine);
    }
  });

  it("rejects start and advance while stopping, and a nested stop is a no-op that resolves", async () => {
    const engine = await createEngine();
    try {
      const seen = watch(engine);
      let nested = 0;
      let stops = 0;
      const rejected: string[] = [];
      engine.hooks.hook("engine:stop", () => {
        stops += 1;
      });
      engine.hooks.hook("engine:state-change", async () => {
        if (engine.state !== "stopping") return;
        await engine.stop();
        nested += 1;
        const startError = await engine.start().then(
          () => undefined,
          (caught: unknown) => caught,
        );
        const advanceError = await engine.advance(1 / 60).then(
          () => undefined,
          (caught: unknown) => caught,
        );
        if (startError instanceof GwenEngineStateError) rejected.push(startError.method);
        if (advanceError instanceof GwenEngineStateError) rejected.push(advanceError.method);
      });
      await engine.startExternal();
      expect(await settles(engine.stop())).toBe(true);
      expect(nested).toBe(1);
      expect(stops).toBe(1);
      expect(rejected).toEqual(["start", "advance"]);
      expect(engine.state).toBe("stopped");
      expect(seen.filter((event) => event.to === "stopping")).toHaveLength(1);
      expect(seen.filter((event) => event.to === "stopped")).toHaveLength(1);
    } finally {
      await shutdown(engine);
    }
  });

  it("rejects start and advance after stop and ignores a fatal", async () => {
    const engine = await createEngine();
    try {
      activateTestWasm(engine);
      const seen = watch(engine);
      let inits = 0;
      let starts = 0;
      engine.hooks.hook("engine:init", () => {
        inits += 1;
      });
      engine.hooks.hook("engine:start", () => {
        starts += 1;
      });
      await engine.startExternal();
      expect(inits).toBe(1);
      expect(starts).toBe(1);
      await engine.stop();
      const afterStop = seen.length;
      let startError: unknown;
      try {
        await engine.start();
      } catch (error) {
        startError = error;
      }
      expect(inits).toBe(1);
      expect(starts).toBe(1);
      expect(startError).toMatchObject({ from: "stopped", method: "start" });
      await expect(engine.startExternal()).rejects.toMatchObject({
        from: "stopped",
        method: "startExternal",
      });
      await expect(engine.advance(1 / 60)).rejects.toMatchObject({
        from: "stopped",
        method: "advance",
      });
      engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "late" });
      expect(engine.state).toBe("stopped");
      expect(seen).toHaveLength(afterStop);
      expect(inits).toBe(1);
      expect(starts).toBe(1);
    } finally {
      await shutdown(engine);
    }
  });

  it("a third-party fatal faults without engine:stop", async () => {
    const engine = await createEngine();
    try {
      const seen = watch(engine);
      let stopped = 0;
      let errors = 0;
      engine.hooks.hook("engine:stop", () => {
        stopped += 1;
      });
      engine.hooks.hook("engine:error", () => {
        errors += 1;
      });
      engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "boom" });
      expect(engine.state).toBe("faulted");
      expect(stopped).toBe(0);
      expect(errors).toBe(1);
      expect(seen).toEqual([{ from: "idle", to: "faulted", reason: "FATAL_ERROR" }]);
      engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "again" });
      expect(seen).toHaveLength(1);
      expect(errors).toBe(2);
      expect(engine.state).toBe("faulted");
    } finally {
      await shutdown(engine);
    }
  });

  it("a fatal during stopping still finishes teardown and stays faulted", async () => {
    const engine = await createEngine();
    try {
      let disposed = 0;
      engine.disposables.add(
        "probe",
        createDisposable(() => {
          disposed += 1;
        }),
      );
      engine.hooks.hook("engine:stop", () => {
        engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "during stop" });
      });
      await engine.startExternal();
      await engine.stop();
      expect(engine.state).toBe("faulted");
      expect(disposed).toBe(1);
    } finally {
      await shutdown(engine);
    }
  });

  it("stop() on a faulted engine tears down once and stays faulted", async () => {
    const engine = await createEngine();
    try {
      let stops = 0;
      let disposed = 0;
      engine.hooks.hook("engine:stop", () => {
        stops += 1;
      });
      engine.disposables.add(
        "probe",
        createDisposable(() => {
          disposed += 1;
        }),
      );
      await engine.startExternal();
      engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "boom" });
      expect(engine.state).toBe("faulted");
      await engine.stop();
      expect(stops).toBe(1);
      expect(disposed).toBe(1);
      expect(engine.state).toBe("faulted");
      await engine.stop();
      expect(stops).toBe(1);
      expect(engine.state).toBe("faulted");
    } finally {
      await shutdown(engine);
    }
  });

  it("stop() awaited inside an engine:stop hook after a fatal resolves, and teardown runs once", async () => {
    const engine = await createEngine();
    try {
      let stops = 0;
      let disposed = 0;
      let nestedResolved = false;
      engine.hooks.hook("engine:stop", async () => {
        stops += 1;
        await engine.stop();
        nestedResolved = true;
      });
      engine.disposables.add(
        "probe",
        createDisposable(() => {
          disposed += 1;
        }),
      );
      await engine.startExternal();
      engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "boom" });
      expect(engine.state).toBe("faulted");
      expect(await settles(engine.stop())).toBe(true);
      expect(nestedResolved).toBe(true);
      expect(stops).toBe(1);
      expect(disposed).toBe(1);
      expect(engine.state).toBe("faulted");
    } finally {
      await shutdown(engine);
    }
  });

  it("an overlapping stop() while faulted does not run engine:stop again", async () => {
    const engine = await createEngine();
    let release: () => void = () => undefined;
    try {
      let stops = 0;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      engine.hooks.hook("engine:stop", () => {
        stops += 1;
        if (stops === 1) void engine.stop();
        return gate;
      });
      await engine.startExternal();
      engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "boom" });
      expect(engine.state).toBe("faulted");
      const pending = engine.stop();
      expect(stops).toBe(1);
      release();
      await pending;
      expect(stops).toBe(1);
      expect(engine.state).toBe("faulted");
    } finally {
      release();
      await shutdown(engine);
    }
  });

  it("a second stop() during teardown resolves immediately, and a later stop() is a no-op", async () => {
    const engine = await createEngine();
    let open: () => void = () => undefined;
    try {
      let stops = 0;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      engine.hooks.hook("engine:stop", () => {
        stops += 1;
        return gate;
      });
      await engine.startExternal();
      const first = engine.stop();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      // engine:stop is running and blocked on the gate.
      expect(stops).toBe(1);
      expect(engine.state).toBe("stopping");
      expect(await settles(engine.stop())).toBe(true);
      expect(engine.state).toBe("stopping");
      open();
      expect(await settles(first)).toBe(true);
      expect(engine.state).toBe("stopped");
      expect(stops).toBe(1);

      await engine.stop();
      expect(stops).toBe(1);
      expect(engine.state).toBe("stopped");
    } finally {
      open();
      await shutdown(engine);
    }
  });

  it("stop() awaited inside an engine:stop hook resolves, and the first stop() completes", async () => {
    const engine = await createEngine();
    try {
      let stops = 0;
      let nestedResolved = false;
      engine.hooks.hook("engine:stop", async () => {
        stops += 1;
        await engine.stop();
        nestedResolved = true;
      });
      await engine.startExternal();
      expect(await settles(engine.stop())).toBe(true);
      expect(nestedResolved).toBe(true);
      expect(stops).toBe(1);
      expect(engine.state).toBe("stopped");
    } finally {
      await shutdown(engine);
    }
  });

  it("stop() awaited inside an engine:state-change handler for stopping resolves, and engine:stop fires once", async () => {
    const engine = await createEngine();
    try {
      let stops = 0;
      let nestedResolved = false;
      engine.hooks.hook("engine:stop", () => {
        stops += 1;
      });
      engine.hooks.hook("engine:state-change", async (payload) => {
        if (payload.to !== "stopping") return;
        await engine.stop();
        nestedResolved = true;
      });
      await engine.startExternal();
      expect(await settles(engine.stop())).toBe(true);
      expect(nestedResolved).toBe(true);
      expect(stops).toBe(1);
      expect(engine.state).toBe("stopped");
    } finally {
      await shutdown(engine);
    }
  });

  it("a fatal while stopping lets one nested stop() finish teardown once", async () => {
    const engine = await createEngine();
    try {
      let stops = 0;
      engine.hooks.hook("engine:stop", () => {
        stops += 1;
      });
      engine.hooks.hook("engine:state-change", (payload) => {
        if (payload.to === "stopping") {
          engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "during stopping" });
        }
        if (payload.to === "faulted") void engine.stop();
      });
      await engine.startExternal();
      await engine.stop();
      expect(stops).toBe(1);
      expect(engine.state).toBe("faulted");
    } finally {
      await shutdown(engine);
    }
  });

  it("a throwing state-change handler does not undo the transition", async () => {
    const logs: string[] = [];
    const engine = await createEngine({
      logger: {
        providers: [
          {
            handle(entry) {
              if (entry.level === "error") logs.push(entry.message);
            },
          },
        ],
      },
    });
    try {
      engine.hooks.hook("engine:state-change", () => {
        throw new Error("handler blew up");
      });
      await engine.startExternal();
      expect(engine.state).toBe("running");
      expect(logs.some((message) => message.includes("handler blew up"))).toBe(true);
    } finally {
      await shutdown(engine);
    }
  });

  it("a second concurrent startExternal rejects and leaves the first running", async () => {
    const engine = await createEngine();
    try {
      const first = engine.startExternal();
      const second = engine.startExternal();
      await expect(second).rejects.toMatchObject({
        from: "starting",
        method: "startExternal",
        code: CoreErrorCodes.INVALID_STATE_TRANSITION,
      });
      await first;
      expect(engine.state).toBe("running");
    } finally {
      await shutdown(engine);
    }
  });

  it("an engine:init throw faults, emits one engine:error, and rejects", async () => {
    const engine = await createEngine();
    try {
      const seen = watch(engine);
      const bus: Array<{ context?: Record<string, unknown> }> = [];
      let errors = 0;
      let starts = 0;
      engine.errors.on((event) => {
        bus.push(event);
      });
      engine.hooks.hook("engine:error", () => {
        errors += 1;
      });
      engine.hooks.hook("engine:init", () => {
        throw new Error("init failed");
      });
      engine.hooks.hook("engine:start", () => {
        starts += 1;
      });
      await expect(engine.startExternal()).rejects.toThrow("init failed");
      expect(engine.state).toBe("faulted");
      expect(errors).toBe(1);
      expect(starts).toBe(0);
      expect(bus[0]).toMatchObject({ context: { hook: "engine:init" } });
      expect(seen).toEqual([
        { from: "idle", to: "starting", reason: "USER" },
        { from: "starting", to: "faulted", reason: "FATAL_ERROR" },
      ]);
    } finally {
      await shutdown(engine);
    }
  });

  it("a fatal on the bus during engine:init does not run engine:start", async () => {
    const engine = await createEngine();
    try {
      const seen = watch(engine);
      let starts = 0;
      engine.hooks.hook("engine:init", () => {
        engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "during init" });
      });
      engine.hooks.hook("engine:start", () => {
        starts += 1;
      });
      await engine.startExternal();
      expect(starts).toBe(0);
      expect(engine.state).toBe("faulted");
      expect(seen).toEqual([
        { from: "idle", to: "starting", reason: "USER" },
        { from: "starting", to: "faulted", reason: "FATAL_ERROR" },
      ]);
    } finally {
      await shutdown(engine);
    }
  });

  it("a trap in plugin setup rejects use, stays idle, and publishes error", async () => {
    const engine = await createEngine();
    try {
      const seen = watch(engine);
      const levels: string[] = [];
      engine.errors.on((event) => {
        levels.push(event.level);
      });
      await expect(
        engine.use({
          name: "trap",
          setup() {
            throw new WebAssembly.RuntimeError("setup trap");
          },
        }),
      ).rejects.toThrow(/setup trap/);
      expect(engine.state).toBe("idle");
      expect(seen).toEqual([]);
      expect(levels).toEqual(["error"]);
    } finally {
      await shutdown(engine);
    }
  });

  it("use and unuse reject while starting, stopping and faulted", async () => {
    const engine = await createEngine();
    const faulted = await createEngine();
    try {
      let setups = 0;
      const methods: string[] = [];
      engine.hooks.hook("engine:state-change", async () => {
        if (engine.state !== "starting" && engine.state !== "stopping") return;
        const error = await engine
          .use({
            name: `late-${engine.state}`,
            setup() {
              setups += 1;
            },
          })
          .then(
            () => undefined,
            (caught: unknown) => caught,
          );
        if (error instanceof GwenEngineStateError) methods.push(`${engine.state}:${error.method}`);
        const unuseError = await engine.unuse("ok").then(
          () => undefined,
          (caught: unknown) => caught,
        );
        if (unuseError instanceof GwenEngineStateError) {
          methods.push(`${engine.state}:${unuseError.method}`);
        }
      });
      await engine.startExternal();
      expect(setups).toBe(0);
      await engine.use({ name: "ok", setup() {} });
      await engine.unuse("ok");
      await engine.stop();
      expect(engine.state).toBe("stopped");
      expect(setups).toBe(0);
      engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "nope" });
      expect(engine.state).toBe("stopped");
      let faultedSetups = 0;
      await faulted.startExternal();
      faulted.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "down" });
      await expect(
        faulted.use({
          name: "no",
          setup() {
            faultedSetups += 1;
          },
        }),
      ).rejects.toMatchObject({
        from: "faulted",
        method: "use",
      });
      await expect(faulted.unuse("missing")).rejects.toMatchObject({
        from: "faulted",
        method: "unuse",
      });
      expect(faultedSetups).toBe(0);
      expect(methods).toEqual(["starting:use", "starting:unuse", "stopping:use", "stopping:unuse"]);
    } finally {
      await shutdown(engine);
      await shutdown(faulted);
    }
  });

  it("use and unuse reject after stop and register nothing", async () => {
    const engine = await createEngine();
    try {
      let setups = 0;
      let teardowns = 0;
      const registered: string[] = [];
      engine.hooks.hook("plugin:registered", (name) => {
        registered.push(name);
      });
      await engine.stop();
      expect(engine.state).toBe("stopped");
      const useError = await engine
        .use({
          name: "late",
          setup() {
            setups += 1;
          },
          teardown() {
            teardowns += 1;
          },
        })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );
      expect(useError).toBeInstanceOf(GwenEngineStateError);
      expect(useError).toMatchObject({ from: "stopped", method: "use" });
      const unuseError = await engine.unuse("late").then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(unuseError).toBeInstanceOf(GwenEngineStateError);
      expect(unuseError).toMatchObject({ from: "stopped", method: "unuse" });
      expect(setups).toBe(0);
      expect(teardowns).toBe(0);
      expect(registered).toEqual([]);
      expect(engine.state).toBe("stopped");
    } finally {
      await shutdown(engine);
    }
  });

  it("an invalid call does not emit on the error bus", async () => {
    const engine = await createEngine();
    try {
      const codes: string[] = [];
      engine.errors.on((event) => {
        codes.push(event.code);
      });
      await engine.startExternal();
      await expect(engine.start()).rejects.toBeInstanceOf(GwenEngineStateError);
      expect(codes).toEqual([]);
      expect(engine.state).toBe("running");
    } finally {
      await shutdown(engine);
    }
  });
});

const HANDLER_FAILED = `[${CoreErrorCodes.ERROR_HANDLER_FAILED}]`;

function machinePair() {
  const hooks = createHooks<GwenRuntimeHooks>();
  const entries: { message: string; payload?: Record<string, unknown> }[] = [];
  const logger = new CoreGwenLogger(
    [
      {
        handle: (entry) => {
          entries.push(
            entry.payload === undefined
              ? { message: entry.message }
              : { message: entry.message, payload: entry.payload },
          );
        },
      },
    ],
    "error",
  );
  let cancelCount = 0;
  const machine = new EngineStateMachine({
    hooks,
    logger,
    cancelFrame: () => {
      cancelCount += 1;
    },
  });
  return {
    hooks,
    entries,
    machine,
    cancels: () => cancelCount,
  };
}

function seenPayloads(hooks: ReturnType<typeof machinePair>["hooks"]): EngineStateChangePayload[] {
  const seen: EngineStateChangePayload[] = [];
  hooks.hook("engine:state-change", (payload) => {
    seen.push({ from: payload.from, to: payload.to, reason: payload.reason });
  });
  return seen;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("EngineStateMachine", () => {
  it("constructs without createEngine and a transition emits the payload while a second machine stays idle", () => {
    const first = machinePair();
    const second = machinePair();
    const seen = seenPayloads(first.hooks);

    expect(first.machine.state).toBe("idle");
    expect(second.machine.state).toBe("idle");

    const pending = first.machine.transition("starting", "USER");

    expect(pending).toBeUndefined();
    expect(first.machine.state).toBe("starting");
    expect(seen).toEqual([{ from: "idle", to: "starting", reason: "USER" }]);
    expect(second.machine.state).toBe("idle");
    expect(second.entries).toEqual([]);

    const other = second.machine.transition("running", "USER");
    expect(other).toBeUndefined();
    expect(second.machine.state).toBe("running");
    expect(first.machine.state).toBe("starting");
  });

  it("constructs without createEngine and state is written before the hook runs", () => {
    const { hooks, machine } = machinePair();
    const other = machinePair();
    let during: GwenEngineState | undefined;
    hooks.hook("engine:state-change", (payload) => {
      during = machine.state;
      expect(machine.state).toBe(payload.to);
    });

    machine.transition("starting", "USER");

    expect(during).toBe("starting");
    expect(other.machine.state).toBe("idle");
  });

  it("constructs without createEngine and a second transition to the same state does not emit", () => {
    const { hooks, machine } = machinePair();
    const seen = seenPayloads(hooks);
    machine.transition("starting", "USER");
    seen.length = 0;

    const pending = machine.transition("starting", "FATAL_ERROR");

    expect(pending).toBeUndefined();
    expect(machine.state).toBe("starting");
    expect(seen).toEqual([]);
  });

  it("constructs without createEngine and a throwing state-change handler keeps the new state and logs once", async () => {
    const first = machinePair();
    const second = machinePair();
    first.hooks.hook("engine:state-change", () => {
      throw new Error("boom");
    });
    second.hooks.hook("engine:state-change", () => {
      throw "plain";
    });

    const pending = first.machine.transition("stopping", "USER");
    expect(first.machine.state).toBe("stopping");
    await pending;
    expect(first.machine.state).toBe("stopping");
    expect(first.entries).toEqual([
      { message: `${HANDLER_FAILED} boom`, payload: { code: CoreErrorCodes.ERROR_HANDLER_FAILED } },
    ]);

    const other = second.machine.transition("running", "USER");
    expect(second.machine.state).toBe("running");
    await other;
    expect(second.entries).toEqual([
      {
        message: `${HANDLER_FAILED} plain`,
        payload: { code: CoreErrorCodes.ERROR_HANDLER_FAILED },
      },
    ]);
    expect(first.machine.state).toBe("stopping");
  });

  it("constructs without createEngine and a rejected state-change hook resolves after the state is set", async () => {
    const { hooks, entries, machine } = machinePair();
    hooks.hook("engine:state-change", () => Promise.reject(new Error("later")));

    const pending = machine.transition("running", "USER");

    expect(machine.state).toBe("running");
    expect(entries).toEqual([]);
    if (pending === undefined) throw new Error("expected a promise");
    await expect(pending).resolves.toBeUndefined();
    expect(machine.state).toBe("running");
    expect(entries).toEqual([
      {
        message: `${HANDLER_FAILED} later`,
        payload: { code: CoreErrorCodes.ERROR_HANDLER_FAILED },
      },
    ]);
  });

  it("constructs without createEngine and assert throws GwenError only while faulted", () => {
    const first = machinePair();
    const second = machinePair();

    first.machine.assert("createEntity");
    expect(first.machine.state).toBe("idle");
    second.machine.assert("run");
    expect(second.machine.state).toBe("idle");

    first.machine.transition("faulted", "WASM_PANIC");
    let caught: unknown;
    try {
      first.machine.assert("createEntity");
    } catch (error) {
      caught = error;
    }
    if (!(caught instanceof GwenError)) throw caught ?? new Error("expected GwenError");
    expect(caught instanceof GwenEngineStateError).toBe(false);
    expect(caught.code).toBe(CoreErrorCodes.INVALID_STATE_TRANSITION);
    expect(caught.composable).toBe("engine.createEntity");
    expect(caught.message).toBe(
      "[engine.createEntity()] Not allowed while the engine is faulted.\nSee https://gwenjs.github.io/gwen/api/errors#core-invalid-state-transition (CORE:INVALID_STATE_TRANSITION)",
    );
    expect(first.machine.state).toBe("faulted");

    second.machine.assert("createEntity");
    expect(second.machine.state).toBe("idle");
  });

  it("constructs without createEngine and use is legal only in idle and running", () => {
    const legal = machinePair();
    legal.machine.assertPlugin("use");
    expect(legal.machine.state).toBe("idle");
    legal.machine.transition("running", "USER");
    legal.machine.assertPlugin("unuse");
    expect(legal.machine.state).toBe("running");

    const illegal: GwenEngineState[] = ["starting", "stopping", "stopped", "faulted"];
    for (const from of illegal) {
      const { machine } = machinePair();
      machine.transition(from, "USER");
      let caught: unknown;
      try {
        machine.assertPlugin("use");
      } catch (error) {
        caught = error;
      }
      if (!(caught instanceof GwenEngineStateError)) {
        throw caught ?? new Error("expected state error");
      }
      expect(caught.from).toBe(from);
      expect(caught.method).toBe("use");
      expect(caught.code).toBe(CoreErrorCodes.INVALID_STATE_TRANSITION);
      expect(caught.composable).toBe("engine.use");
      expect(caught.message).toBe(
        `[engine.use()] Not allowed while the engine is ${from}.\nSee https://gwenjs.github.io/gwen/api/errors#core-invalid-state-transition (CORE:INVALID_STATE_TRANSITION)`,
      );
      expect(machine.state).toBe(from);
    }

    legal.machine.assertPlugin("use");
    expect(legal.machine.state).toBe("running");
  });

  it("constructs without createEngine and enterFaulted cancels once then stays faulted", async () => {
    const running = machinePair();
    const seen = seenPayloads(running.hooks);
    expect(running.machine.isFaulted()).toBe(false);

    running.machine.transition("running", "USER");
    seen.length = 0;
    running.machine.enterFaulted("WASM_PANIC");

    expect(running.cancels()).toBe(1);
    expect(running.machine.state).toBe("faulted");
    expect(running.machine.isFaulted()).toBe(true);
    expect(seen).toEqual([{ from: "running", to: "faulted", reason: "WASM_PANIC" }]);

    running.machine.enterFaulted("FATAL_ERROR");
    expect(running.cancels()).toBe(1);
    expect(seen).toEqual([{ from: "running", to: "faulted", reason: "WASM_PANIC" }]);
    expect(running.machine.state).toBe("faulted");

    const stopped = machinePair();
    stopped.machine.transition("stopped", "USER");
    stopped.machine.enterFaulted("WASM_PANIC");
    expect(stopped.cancels()).toBe(0);
    expect(stopped.machine.state).toBe("stopped");
    expect(stopped.machine.isFaulted()).toBe(false);

    const idle = machinePair();
    idle.machine.enterFaulted("FATAL_ERROR");
    expect(idle.cancels()).toBe(1);
    expect(idle.machine.state).toBe("faulted");
    expect(idle.machine.isFaulted()).toBe(true);

    const noisy = machinePair();
    noisy.hooks.hook("engine:state-change", (payload) => {
      if (payload.to === "faulted") return Promise.reject(new Error("panic-log"));
    });
    noisy.machine.transition("running", "USER");
    expect(noisy.entries).toEqual([]);
    noisy.machine.enterFaulted("WASM_PANIC");
    expect(noisy.machine.state).toBe("faulted");
    expect(noisy.cancels()).toBe(1);
    await flushMicrotasks();
    expect(noisy.entries).toEqual([
      {
        message: `${HANDLER_FAILED} panic-log`,
        payload: { code: CoreErrorCodes.ERROR_HANDLER_FAILED },
      },
    ]);
    noisy.machine.enterFaulted("FATAL_ERROR");
    await flushMicrotasks();
    expect(noisy.cancels()).toBe(1);
    expect(noisy.entries).toHaveLength(1);
    expect(noisy.machine.state).toBe("faulted");
  });
});
