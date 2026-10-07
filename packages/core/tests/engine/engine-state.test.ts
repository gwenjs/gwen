import { describe, expect, it } from "vitest";

import { createDisposable } from "../../src/disposable";
import {
  CoreErrorCodes,
  GwenEngineStateError,
  createEngine,
  type GwenEngine,
} from "../../src/index";
import { activateTestWasm } from "../helpers/activate-test-wasm";

type Change = { from: string; to: string; reason: string };

function watch(engine: GwenEngine): Change[] {
  const seen: Change[] = [];
  engine.hooks.hook("engine:state-change", (payload) => {
    seen.push({ from: payload.from, to: payload.to, reason: payload.reason });
  });
  return seen;
}

describe("engine state machine", () => {
  it("orders start and stop hooks around the lifecycle transitions", async () => {
    const engine = await createEngine();
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
  });

  it("start() follows the same order when WASM is active", async () => {
    const engine = await createEngine();
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
  });

  it("stop() from idle ends stopped", async () => {
    const engine = await createEngine();
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
  });

  it("rejects start, advance, and stop while starting", async () => {
    const engine = await createEngine();
    const rejected: GwenEngineStateError[] = [];
    engine.hooks.hook("engine:state-change", async () => {
      if (engine.state !== "starting") return;
      const calls = [engine.start(), engine.startExternal(), engine.advance(1 / 60), engine.stop()];
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
  });

  it("rejects a second start while running and still advances", async () => {
    const engine = await createEngine();
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
  });

  it("rejects start and advance while stopping, and a nested stop is a no-op", async () => {
    const engine = await createEngine();
    const seen = watch(engine);
    let nested = 0;
    const rejected: string[] = [];
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
    await engine.stop();
    expect(nested).toBe(1);
    expect(rejected).toEqual(["start", "advance"]);
    expect(engine.state).toBe("stopped");
    expect(seen.filter((event) => event.to === "stopping")).toHaveLength(1);
    expect(seen.filter((event) => event.to === "stopped")).toHaveLength(1);
  });

  it("rejects start and advance after stop and ignores a fatal", async () => {
    const engine = await createEngine();
    try {
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
      await expect(engine.start()).rejects.toMatchObject({ from: "stopped", method: "start" });
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
      await engine.stop();
    }
  });

  it("a third-party fatal faults without engine:stop", async () => {
    const engine = await createEngine();
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
  });

  it("a fatal during stopping still finishes teardown and stays faulted", async () => {
    const engine = await createEngine();
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
  });

  it("stop() on a faulted engine tears down once and stays faulted", async () => {
    const engine = await createEngine();
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
  });

  it("an overlapping stop() while faulted does not run engine:stop again", async () => {
    const engine = await createEngine();
    let stops = 0;
    let release: () => void = () => undefined;
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
  });

  it("a fatal while stopping lets one nested stop() finish teardown once", async () => {
    const engine = await createEngine();
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
  });

  it("a throwing state-change handler does not undo the transition", async () => {
    const engine = await createEngine();
    const logs: string[] = [];
    engine.logger.setSink((entry) => {
      if (entry.level === "error") logs.push(entry.message);
    });
    engine.hooks.hook("engine:state-change", () => {
      throw new Error("handler blew up");
    });
    await engine.startExternal();
    expect(engine.state).toBe("running");
    expect(logs.some((message) => message.includes("handler blew up"))).toBe(true);
  });

  it("a second concurrent startExternal rejects and leaves the first running", async () => {
    const engine = await createEngine();
    const first = engine.startExternal();
    const second = engine.startExternal();
    await expect(second).rejects.toMatchObject({
      from: "starting",
      method: "startExternal",
      code: CoreErrorCodes.INVALID_STATE_TRANSITION,
    });
    await first;
    expect(engine.state).toBe("running");
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
      await engine.stop();
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
      await engine.stop();
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
      await engine.stop();
    }
  });

  it("use and unuse are legal while starting and reject in stopping and faulted", async () => {
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
      });
      await engine.startExternal();
      expect(setups).toBe(1);
      await engine.use({ name: "ok", setup() {} });
      await engine.unuse("ok");
      await engine.stop();
      await engine.use({ name: "after", setup() {} });
      expect(engine.state).toBe("stopped");
      engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "nope" });
      expect(engine.state).toBe("stopped");
      await faulted.startExternal();
      faulted.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "down" });
      await expect(faulted.use({ name: "no", setup() {} })).rejects.toMatchObject({
        from: "faulted",
        method: "use",
      });
      await expect(faulted.unuse("missing")).rejects.toMatchObject({
        from: "faulted",
        method: "unuse",
      });
      expect(methods).toEqual(["stopping:use"]);
    } finally {
      await engine.stop();
      await faulted.stop();
    }
  });

  it("an invalid call does not emit on the error bus", async () => {
    const engine = await createEngine();
    const codes: string[] = [];
    engine.errors.on((event) => {
      codes.push(event.code);
    });
    await engine.startExternal();
    await expect(engine.start()).rejects.toBeInstanceOf(GwenEngineStateError);
    expect(codes).toEqual([]);
    expect(engine.state).toBe("running");
  });
});
