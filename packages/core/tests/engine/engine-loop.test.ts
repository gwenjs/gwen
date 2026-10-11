import { createHooks } from "hookable";
import { GwenError } from "@gwenjs/schema";
import { describe, expect, it } from "vitest";

import { DisposableRegistry } from "../../src/disposable.js";
import { createErrorBus } from "../../src/engine/error-bus.js";
import { EngineErrorPolicy } from "../../src/engine/engine-error-policy.js";
import { CoreErrorCodes } from "../../src/engine/engine-errors.js";
import { EngineLoop, type EngineLoopConfig } from "../../src/engine/engine-loop.js";
import { EngineMemory } from "../../src/engine/engine-memory.js";
import { EngineStateMachine } from "../../src/engine/engine-state.js";
import { EngineStatsRecorder } from "../../src/engine/engine-stats.js";
import type { GwenRuntimeHooks } from "../../src/engine/runtime-hooks.js";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge.js";
import { createEngine, useEngine } from "../../src/index.js";
import { GwenLogger } from "../../src/logger/gwen-logger.js";

const REENTRANT = "[GwenEngine] advance() called re-entrantly — only one advance per frame.";

interface HarnessOptions {
  grow?: boolean;
  warns?: string[];
}

interface Harness {
  config: EngineLoopConfig;
  order: string[];
  ticks: number[];
  loop: EngineLoop;
  modules: {
    stepAll(dt: number): void;
    checkSentinels(): void;
  };
  stats: EngineStatsRecorder;
  state: EngineStateMachine;
  hooks: ReturnType<typeof createHooks<GwenRuntimeHooks>>;
  stop(): Promise<void>;
}

async function harness(
  overrides: Partial<EngineLoopConfig> = {},
  options: HarnessOptions = {},
): Promise<Harness> {
  const owner = await createEngine();
  const hooks = createHooks<GwenRuntimeHooks>();
  const warns = options.warns;
  const logger = new GwenLogger(
    [
      {
        handle(entry) {
          if (warns !== undefined && entry.level === "warn") warns.push(entry.message);
        },
      },
    ],
    warns === undefined ? "error" : "debug",
  );
  const config: EngineLoopConfig = {
    timeScale: 1,
    physicsHz: 0,
    maxCatchupSteps: 2,
    targetFPS: 60,
    maxDeltaSeconds: 0.1,
    debug: false,
    ...overrides,
  };
  const order: string[] = [];
  const ticks: number[] = [];
  const loopBox: { loop?: EngineLoop } = {};
  const stats = new EngineStatsRecorder({
    targetFPS: config.targetFPS,
    debug: config.debug,
    entityCount: () => 0,
    linearMemory: () => null,
    phaseMs: () => loopBox.loop?.lastPhaseMs,
  });
  const state = new EngineStateMachine({
    hooks,
    logger,
    cancelFrame: () => loopBox.loop?.cancel(),
  });
  const bus = createErrorBus({ logger });
  const disposables = new DisposableRegistry();
  const policy = new EngineErrorPolicy({
    bus,
    hooks,
    logger,
    state,
    frame: () => stats.frameCount,
    debug: config.debug,
    owner,
    disposables,
    pluginNamed: () => undefined,
    bridge: {},
  });
  const memory = new EngineMemory(new WasmBridgeImpl(), bus);
  const bridge = {
    checkMemoryGrow(): boolean {
      return options.grow === true;
    },
    getLinearMemory(): WebAssembly.Memory | null {
      return null;
    },
    engine() {
      return {
        update_transforms() {
          order.push("transforms");
        },
      };
    },
  };
  const modules = {
    stepAll() {
      order.push("modules");
    },
    checkSentinels() {
      order.push("sentinels");
    },
  };
  const loop = new EngineLoop({
    owner,
    config,
    hooks,
    stats,
    modules,
    bridge,
    memory,
    policy,
    state,
    logger,
  });
  loopBox.loop = loop;
  hooks.hook("engine:tick", (dt: number) => {
    order.push("tick");
    ticks.push(dt);
  });
  hooks.hook("engine:before-update", () => {
    order.push("before-update");
  });
  hooks.hook("engine:update", () => {
    order.push(`update:${stats.frameCount}`);
  });
  hooks.hook("engine:after-update", () => {
    order.push("after-update");
  });
  hooks.hook("engine:render", () => {
    order.push("render");
  });
  hooks.hook("engine:afterTick", () => {
    order.push(`afterTick:${stats.frameCount}`);
  });
  return {
    config,
    order,
    ticks,
    loop,
    modules,
    stats,
    state,
    hooks,
    async stop() {
      disposables.disposeAll();
      if (owner.state !== "stopped") await owner.stop();
    },
  };
}

describe("EngineLoop", () => {
  it("phase order is tick then modules then transforms then update then afterTick", async () => {
    const rig = await harness();
    try {
      await rig.loop.advance(1 / 60);
      expect(rig.order).toEqual([
        "tick",
        "before-update",
        "modules",
        "transforms",
        "update:0",
        "after-update",
        "render",
        "afterTick:1",
      ]);
    } finally {
      await rig.stop();
    }
  });

  it("a re-entrant advance throws CORE:ADVANCE_REENTRANT", async () => {
    const rig = await harness();
    let caught: unknown;
    let entered = false;
    rig.hooks.hook("engine:before-update", () => {
      if (entered) return;
      entered = true;
      return rig.loop.advance(0).then(
        () => undefined,
        (error: unknown) => {
          caught = error;
        },
      );
    });
    try {
      await rig.loop.advance(1 / 60);
      if (!(caught instanceof GwenError)) {
        throw new Error("expected GwenError");
      }
      expect(caught.code).toBe(CoreErrorCodes.ADVANCE_REENTRANT);
      expect(caught.message).toBe(REENTRANT);
    } finally {
      await rig.stop();
    }
  });

  it("advance(1) with maxDeltaSeconds 0.1 and timeScale 2 sets deltaTime 0.2", async () => {
    const rig = await harness({ timeScale: 2, maxDeltaSeconds: 0.1 });
    try {
      await rig.loop.advance(1);
      expect(rig.ticks).toEqual([0.2]);
      expect(rig.stats.deltaTime).toBe(0.2);
    } finally {
      await rig.stop();
    }
  });

  it("a timeScale change after construction changes the next advance", async () => {
    const rig = await harness({ timeScale: 1, maxDeltaSeconds: 0.1 });
    try {
      rig.config.timeScale = 0;
      await rig.loop.advance(1);
      expect(rig.ticks).toEqual([0]);
      expect(rig.stats.deltaTime).toBe(0);
    } finally {
      await rig.stop();
    }
  });

  it("two loops do not share deltaTime", async () => {
    const first = await harness({ timeScale: 2, maxDeltaSeconds: 0.1 });
    const second = await harness({ timeScale: 1, maxDeltaSeconds: 0.1 });
    try {
      await first.loop.advance(1);
      await second.loop.advance(1);
      expect(first.ticks).toEqual([0.2]);
      expect(second.ticks).toEqual([0.1]);
      expect(first.stats.deltaTime).toBe(0.2);
      expect(second.stats.deltaTime).toBe(0.1);
    } finally {
      await second.stop();
      await first.stop();
    }
  });

  it("fixed mode runs at most maxCatchupSteps steps", async () => {
    const rig = await harness({ physicsHz: 60, maxCatchupSteps: 2, maxDeltaSeconds: 1 });
    const previousRaf = globalThis.requestAnimationFrame;
    const previousCancel = globalThis.cancelAnimationFrame;
    const previousNow = performance.now;
    const slot: { current: ((now: number) => void) | null } = { current: null };
    let clock = 1_000;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      slot.current = (now: number) => cb(now);
      return 7;
    };
    globalThis.cancelAnimationFrame = () => {
      slot.current = null;
    };
    performance.now = () => clock;
    try {
      rig.state.transition("running", "USER");
      rig.loop.markStart();
      rig.loop.startScheduled();
      const frame = slot.current;
      slot.current = null;
      if (frame === null) throw new Error("no frame scheduled");
      clock = 6_000;
      await frame(clock);
      expect(rig.ticks).toHaveLength(2);
    } finally {
      globalThis.requestAnimationFrame = previousRaf;
      globalThis.cancelAnimationFrame = previousCancel;
      performance.now = previousNow;
      await rig.stop();
    }
  });

  it("cancel drops the scheduled frame", async () => {
    const rig = await harness({ physicsHz: 0, targetFPS: 60 });
    const previousRaf = globalThis.requestAnimationFrame;
    const previousCancel = globalThis.cancelAnimationFrame;
    let queued: ((now: number) => void) | null = null;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      queued = (now: number) => {
        void cb(now);
      };
      return 4;
    };
    globalThis.cancelAnimationFrame = () => {
      queued = null;
    };
    try {
      rig.state.transition("running", "USER");
      rig.loop.markStart();
      rig.loop.startScheduled();
      expect(queued).not.toBeNull();
      rig.loop.cancel();
      expect(queued).toBeNull();
      expect(rig.ticks).toEqual([]);
    } finally {
      globalThis.requestAnimationFrame = previousRaf;
      globalThis.cancelAnimationFrame = previousCancel;
      await rig.stop();
    }
  });

  it("memory-grow runs before each phase when checkMemoryGrow is true", async () => {
    const rig = await harness({}, { grow: true });
    rig.hooks.hook("engine:memory-grow", () => {
      rig.order.push("grow");
    });
    try {
      await rig.loop.advance(1 / 60);
      expect(rig.order).toEqual([
        "grow",
        "tick",
        "grow",
        "before-update",
        "grow",
        "modules",
        "grow",
        "transforms",
        "grow",
        "update:0",
        "grow",
        "after-update",
        "render",
        "grow",
        "afterTick:1",
      ]);
    } finally {
      await rig.stop();
    }
  });

  it("a microtask queued in stepAll runs after the update hook", async () => {
    const rig = await harness();
    rig.modules.stepAll = () => {
      rig.order.push("stepAll");
      queueMicrotask(() => {
        rig.order.push("micro");
      });
    };
    try {
      await rig.loop.advance(1 / 60);
      expect(rig.order).toEqual([
        "tick",
        "before-update",
        "stepAll",
        "transforms",
        "update:0",
        "after-update",
        "render",
        "afterTick:1",
        "micro",
      ]);
    } finally {
      await rig.stop();
    }
  });

  it("a fatal during after-update skips engine:render", async () => {
    const rig = await harness();
    rig.hooks.hook("engine:after-update", () => {
      throw new WebAssembly.RuntimeError("trap");
    });
    try {
      await rig.loop.advance(1 / 60);
      expect(rig.state.state).toBe("faulted");
      expect(rig.order).toContain("after-update");
      expect(rig.order).not.toContain("render");
    } finally {
      await rig.stop();
    }
  });

  it("debug warns when each phase exceeds half the budget, in phase order", async () => {
    const warns: string[] = [];
    const rig = await harness({ debug: true, targetFPS: 60 }, { warns });
    const previousNow = performance.now;
    let clock = 0;
    performance.now = () => {
      clock += 20;
      return clock;
    };
    try {
      await rig.loop.advance(1 / 60);
      if (__GWEN_DEV__) {
        expect(warns).toEqual([
          'phase "tick" exceeded 50% of frame budget',
          'phase "plugins" exceeded 50% of frame budget',
          'phase "wasm" exceeded 50% of frame budget',
          'phase "update" exceeded 50% of frame budget',
          'phase "render" exceeded 50% of frame budget',
          'phase "afterTick" exceeded 50% of frame budget',
        ]);
      } else {
        expect(warns).toEqual([]);
      }
    } finally {
      performance.now = previousNow;
      await rig.stop();
    }
  });

  it("createEngine advance restores the engine that was current, including after an awaited hook", async () => {
    const first = await createEngine();
    const second = await createEngine();
    try {
      first.activate();
      await second.advance(1 / 60);
      expect(useEngine()).toBe(first);
      second.hooks.hook("engine:update", async () => {
        await Promise.resolve();
      });
      await second.advance(1 / 60);
      expect(useEngine()).toBe(first);
    } finally {
      first.deactivate();
      if (second.state !== "stopped") await second.stop();
      if (first.state !== "stopped") await first.stop();
    }
  });
});
