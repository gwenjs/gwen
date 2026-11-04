import { afterEach, expect, it } from "vitest";
import { definePlugin } from "@gwenjs/kit/plugin";
import {
  GWEN_RESERVED_HOOK_NAMESPACES,
  type GwenRuntimeHookName,
  type GwenUserHookName,
  type HookBusBase,
  type HookHandlerMap,
} from "@gwenjs/schema";
import { GwenScope } from "../../src/context/scope";
import { createEngine } from "../../src/node";
import type { GwenEngine } from "../../src/engine/engine-types";
import { GwenHookNameError } from "../../src/engine/engine-errors";
import { defineHooks } from "../../src/hooks/define-hooks";
import { emit } from "../../src/hooks/emit";
import { ScopedHookable } from "../../src/hooks/scoped-hookable";
import { useHook } from "../../src/hooks/use-hook";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "hookname:svc": { readonly n: number };
  }
}

/** Named import is undefined on the base. This assertion fails before `toBeInstanceOf`. */
function expectHookNameClass(): void {
  expect(typeof GwenHookNameError).toBe("function");
}

type OpenEngine = Awaited<ReturnType<typeof createEngine>>;

const engines: OpenEngine[] = [];

afterEach(async () => {
  const open = engines.splice(0);
  for (const engine of open) await engine.stop();
});

async function openEngine(): Promise<OpenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  return engine;
}

/** One cast from a string the type system rejects. */
function emitCast(name: string): void {
  emit(name as GwenUserHookName);
}

function mapNamed(name: string): HookHandlerMap {
  const map: HookHandlerMap = {};
  map[name] = () => undefined;
  return map;
}

interface CallHooks {
  callHook(name: string, ...args: unknown[]): unknown;
  callHookParallel(name: string, ...args: unknown[]): unknown;
  callHookWith(
    caller: (hooks: readonly unknown[], args: readonly unknown[]) => unknown,
    name: string,
    args: readonly unknown[],
  ): unknown;
}

function callsOf(hooks: HookBusBase): CallHooks {
  const withCalls: HookBusBase & CallHooks = hooks as HookBusBase & CallHooks;
  return withCalls;
}

function caught(run: () => void): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

it("::useHook with a name without a colon throws GwenHookNameError reason format and registers nothing", async () => {
  expectHookNameClass();
  const engine = await openEngine();
  const codes: string[] = [];
  const off = engine.errors.on((payload) => {
    codes.push(payload.code);
  });
  const reached: number[] = [];
  const name = "noColon" as GwenRuntimeHookName;
  const error = caught(() => {
    engine.run(() => {
      useHook(name, () => {
        reached.push(1);
      });
    });
  });
  expect(error).toBeInstanceOf(GwenHookNameError);
  if (!(error instanceof GwenHookNameError)) return;
  expect(error.code).toBe("CORE:HOOK_NAME_INVALID");
  expect(error.hookName).toBe("noColon");
  expect(error.reason).toBe("format");
  expect(error.composable).toBe("useHook");
  engine.hooks.callHook(name);
  expect(reached).toEqual([]);
  expect(codes).toEqual([]);
  off();
});

it("::emit on engine:tick throws reason reserved and no handler runs", async () => {
  expectHookNameClass();
  const engine = await openEngine();
  const reached: number[] = [];
  engine.hooks.hook("engine:tick", () => {
    reached.push(1);
  });
  const error = caught(() => {
    engine.run(() => {
      emitCast("engine:tick");
    });
  });
  expect(error).toBeInstanceOf(GwenHookNameError);
  if (!(error instanceof GwenHookNameError)) return;
  expect(error.reason).toBe("reserved");
  expect(error.hookName).toBe("engine:tick");
  expect(error.composable).toBe("emit");
  expect(reached).toEqual([]);
});

it("::defineHooks with a reserved key throws at module evaluation", () => {
  expectHookNameClass();
  const error = caught(() => {
    defineHooks(mapNamed("engine:x"));
  });
  expect(error).toBeInstanceOf(GwenHookNameError);
  if (!(error instanceof GwenHookNameError)) return;
  expect(error.reason).toBe("reserved");
  expect(error.hookName).toBe("engine:x");
  expect(error.composable).toBe("defineHooks");
});

it("::useHook may subscribe to engine:tick", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  const seen: number[] = [];
  engine.run(() => {
    useHook("engine:tick", (dt) => {
      seen.push(dt);
    });
  });
  engine.hooks.callHook("engine:tick", 0.5);
  expect(seen).toEqual([0.5]);
});

it('::a plugin-scoped engine.hooks.hook rejects ":x"', async () => {
  expectHookNameClass();
  const engine = await openEngine();
  const events: { code: string; error: unknown }[] = [];
  const off = engine.errors.on((payload) => {
    events.push({ code: payload.code, error: payload.error });
  });
  const reached: number[] = [];
  const plugin = definePlugin(() => ({
    name: "bad-hook",
    setup(host) {
      host.hooks.hook(":x" as GwenRuntimeHookName, () => {
        reached.push(1);
      });
    },
  }));
  await expect(engine.use(plugin())).rejects.toBeInstanceOf(GwenHookNameError);
  expect(events).toHaveLength(1);
  expect(events[0]?.code).toBe("CORE:PLUGIN_SETUP_ERROR");
  expect(events[0]?.error).toBeInstanceOf(GwenHookNameError);
  expect(reached).toEqual([]);
  off();
});

it('::scope.hook rejects "x:"', async () => {
  expectHookNameClass();
  const engine = await openEngine();
  const scope = new GwenScope(engine, { type: "plugin", name: "scope-hook" });
  try {
    const error = caught(() => {
      scope.hook("x:" as GwenRuntimeHookName, () => undefined);
    });
    expect(error).toBeInstanceOf(GwenHookNameError);
    if (!(error instanceof GwenHookNameError)) return;
    expect(error.reason).toBe("format");
    expect(error.hookName).toBe("x:");
    expect(error.composable).toBe("scope.hook");
    expect(scope.hookCount).toBe(0);
  } finally {
    scope.dispose();
  }
});

it('::ScopedHookable.hook rejects "x:"', async () => {
  expectHookNameClass();
  const engine = await openEngine();
  const scoped = new ScopedHookable(engine.hooks);
  const reached: number[] = [];
  try {
    const error = caught(() => {
      scoped.hook("x:" as GwenRuntimeHookName, () => {
        reached.push(1);
      });
    });
    expect(error).toBeInstanceOf(GwenHookNameError);
    if (!(error instanceof GwenHookNameError)) return;
    expect(error.reason).toBe("format");
    expect(error.composable).toBe("scope.hook");
    engine.hooks.callHook("x:" as GwenRuntimeHookName);
    expect(reached).toEqual([]);
  } finally {
    scoped.dispose();
  }
});

it("::a well-formed undeclared name is a no-op at runtime", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  const codes: string[] = [];
  const off = engine.errors.on((payload) => {
    codes.push(payload.code);
  });
  try {
    engine.run(() => {
      emitCast("nobody:declared");
    });
    expect(codes).toEqual([]);
  } finally {
    off();
  }
});

const BOUNDARIES = [
  ["", "format"],
  [":", "format"],
  ["a:", "format"],
  [":a", "format"],
  ["a:b", "ok"],
  ["a:b:c", "ok"],
  ["service:", "format"],
  ["service:a", "reserved"],
] as const;

it.each(BOUNDARIES)("::emit boundary %j is %s", async (name, reason) => {
  expectHookNameClass();
  const engine = await openEngine();
  const error = caught(() => {
    engine.run(() => {
      emitCast(name);
    });
  });
  if (reason === "ok") {
    expect(error).toBeUndefined();
    return;
  }
  expect(error).toBeInstanceOf(GwenHookNameError);
  if (!(error instanceof GwenHookNameError)) return;
  expect(error.reason).toBe(reason);
  expect(error.hookName).toBe(name);
});

const RESERVED = ["engine", "entity", "scene", "plugin", "actor", "prefab", "service"] as const;

it.each(RESERVED)("::emit rejects every core-reserved namespace %s", async (ns) => {
  expectHookNameClass();
  const engine = await openEngine();
  const reached: number[] = [];
  const name = `${ns}:x`;
  engine.hooks.hook(name as GwenRuntimeHookName, () => {
    reached.push(1);
  });
  const error = caught(() => {
    engine.run(() => {
      emitCast(name);
    });
  });
  expect(error).toBeInstanceOf(GwenHookNameError);
  if (!(error instanceof GwenHookNameError)) return;
  expect(error.reason).toBe("reserved");
  expect(reached).toEqual([]);
});

const NEIGHBORS = ["services:x", "scenery:x", "engineX:y", "plugins:x", "actors:x"] as const;

it.each(NEIGHBORS)("::emit accepts names next to the reserved ones %s", async (name) => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  const codes: string[] = [];
  const off = engine.errors.on((payload) => {
    codes.push(payload.code);
  });
  try {
    engine.run(() => {
      emitCast(name);
    });
    expect(codes).toEqual([]);
  } finally {
    off();
  }
});

it("::the reserved switch equals GWEN_RESERVED_HOOK_NAMESPACES", async () => {
  expectHookNameClass();
  const engine = await openEngine();
  const reserved: string[] = [];
  engine.run(() => {
    for (const ns of GWEN_RESERVED_HOOK_NAMESPACES) {
      const error = caught(() => {
        emitCast(`${ns}:x`);
      });
      expect(error).toBeInstanceOf(GwenHookNameError);
      if (!(error instanceof GwenHookNameError)) return;
      expect(error.reason).toBe("reserved");
      reserved.push(ns);
      const neighbor = caught(() => {
        emitCast(`${ns}s:x`);
      });
      expect(neighbor).toBeUndefined();
    }
  });
  expect(reserved).toEqual([...GWEN_RESERVED_HOOK_NAMESPACES]);
});

it.each(["scene:x", "service:x", "prefab:x"] as const)(
  "::defineHooks rejects a reserved key at module evaluation %s",
  (name) => {
    expectHookNameClass();
    const error = caught(() => {
      defineHooks(mapNamed(name));
    });
    expect(error).toBeInstanceOf(GwenHookNameError);
    if (!(error instanceof GwenHookNameError)) return;
    expect(error.reason).toBe("reserved");
    expect(error.hookName).toBe(name);
  },
);

it("::defineHooks rejects a framework namespace key", () => {
  expect(typeof GwenHookNameError).toBe("function");
  // compile error only (test-d), no runtime throw
  const map = mapNamed("camera:x");
  expect(defineHooks(map)).toBe(map);
});

const CALLS = ["callHook", "callHookParallel", "callHookWith"] as const;

it.each(CALLS)(
  "::a plugin calling engine.hooks.%s on a reserved name rejects use()",
  async (method) => {
    expectHookNameClass();
    const engine = await openEngine();
    const reached: string[] = [];
    engine.hooks.hook("scene:enter", (name) => {
      reached.push(name);
    });
    const plugin = definePlugin(() => ({
      name: `call-${method}`,
      setup(host) {
        const hooks = callsOf(host.hooks);
        if (method === "callHookWith") {
          hooks.callHookWith(
            (hookList) => {
              for (const hook of hookList) {
                if (typeof hook === "function") hook("boss");
              }
            },
            "scene:enter",
            ["boss"],
          );
          return;
        }
        hooks[method]("scene:enter", "boss");
      },
    }));
    await expect(engine.use(plugin())).rejects.toBeInstanceOf(GwenHookNameError);
    expect(reached).toEqual([]);
  },
);

it("::a plugin emits its own declared hook through the scoped proxy", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  const seen: string[] = [];
  engine.hooks.hook("mine:ping" as GwenRuntimeHookName, () => {
    seen.push("ping");
  });
  const plugin = definePlugin(() => ({
    name: "mine",
    setup(host) {
      callsOf(host.hooks).callHook("mine:ping");
    },
  }));
  await engine.use(plugin());
  expect(seen).toEqual(["ping"]);
});

it("::the scoped trap is created once per install", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  let first: unknown;
  let second: unknown;
  const plugin = definePlugin(() => ({
    name: "once",
    setup(host) {
      const hooks = callsOf(host.hooks);
      first = hooks.callHook;
      second = hooks.callHook;
    },
  }));
  await engine.use(plugin());
  expect(second).toBe(first);
});

it("::two engines: a plugin on engine B cannot emit scene:enter on engine B, engine A's listener is untouched", async () => {
  expectHookNameClass();
  const engineA = await openEngine();
  const engineB = await openEngine();
  const seenA: string[] = [];
  const seenB: string[] = [];
  engineA.hooks.hook("scene:enter", (name) => {
    seenA.push(name);
  });
  engineB.hooks.hook("scene:enter", (name) => {
    seenB.push(name);
  });
  const plugin = definePlugin(() => ({
    name: "cross",
    setup(host) {
      callsOf(host.hooks).callHook("scene:enter", "boss");
    },
  }));
  await expect(engineB.use(plugin())).rejects.toBeInstanceOf(GwenHookNameError);
  expect(seenA).toEqual([]);
  expect(seenB).toEqual([]);
});

it("::after unuse and re-use the trap still rejects", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  const seen: string[] = [];
  engine.hooks.hook("scene:enter", (name) => {
    seen.push(name);
  });
  let installed: CallHooks | undefined;
  const plugin = definePlugin(() => ({
    name: "again",
    setup(host) {
      installed = callsOf(host.hooks);
    },
  }));
  await engine.use(plugin());
  await engine.unuse("again");
  await engine.use(plugin());
  const error = caught(() => {
    installed?.callHook("scene:enter", "boss");
  });
  expect(error).toBeInstanceOf(GwenHookNameError);
  expect(seen).toEqual([]);
});

it("::a plugin whose setup installs another plugin still installs it and fires plugin:registered for both", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  const names: string[] = [];
  engine.hooks.hook("plugin:registered", (pluginName) => {
    names.push(pluginName);
  });
  const inner = definePlugin(() => ({
    name: "inner",
    setup() {
      return undefined;
    },
  }));
  const outer = definePlugin(() => ({
    name: "outer",
    async setup(host) {
      // The setup argument is the scoped engine. `use` on it is the nested path.
      await (host as GwenEngine).use(inner());
    },
  }));
  await expect(engine.use(outer())).resolves.toBeUndefined();
  expect(names).toEqual(["inner", "outer"]);
});

it("::a plugin that kept its setup engine can stop and the engine:stop listener runs", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  const codes: string[] = [];
  const off = engine.errors.on((payload) => {
    codes.push(payload.code);
  });
  const stops: number[] = [];
  engine.hooks.hook("engine:stop", () => {
    stops.push(1);
  });
  let host: GwenEngine | undefined;
  const plugin = definePlugin(() => ({
    name: "keep-stop",
    setup(setupEngine) {
      host = setupEngine as GwenEngine;
    },
  }));
  try {
    await engine.use(plugin());
    await host?.stop();
    expect(stops).toEqual([1]);
    expect(codes).toEqual([]);
  } finally {
    off();
  }
});

it("::a plugin that kept its setup engine can startExternal and engine:init runs", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  const codes: string[] = [];
  const off = engine.errors.on((payload) => {
    codes.push(payload.code);
  });
  const inits: number[] = [];
  const starts: number[] = [];
  engine.hooks.hook("engine:init", () => {
    inits.push(1);
  });
  engine.hooks.hook("engine:start", () => {
    starts.push(1);
  });
  let host: GwenEngine | undefined;
  const plugin = definePlugin(() => ({
    name: "keep-start",
    setup(setupEngine) {
      host = setupEngine as GwenEngine;
    },
  }));
  try {
    await engine.use(plugin());
    let thrown: unknown;
    try {
      await host?.startExternal();
    } catch (error: unknown) {
      thrown = error;
    }
    expect(inits).toEqual([1]);
    expect(starts).toEqual([1]);
    expect(codes).toEqual([]);
    expect(thrown).toBeUndefined();
  } finally {
    off();
  }
});

it("::a plugin createEntity on the setup engine fires entity:spawn", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  const codes: string[] = [];
  const off = engine.errors.on((payload) => {
    codes.push(payload.code);
  });
  const spawned: number[] = [];
  engine.hooks.hook("entity:spawn", () => {
    spawned.push(1);
  });
  const plugin = definePlugin(() => ({
    name: "setup-spawn",
    setup(setupEngine) {
      (setupEngine as GwenEngine).createEntity();
    },
  }));
  try {
    await engine.use(plugin());
    expect(spawned).toEqual([1]);
    expect(codes).toEqual([]);
  } finally {
    off();
  }
});

it("::a plugin destroyEntity on the setup engine fires entity:destroy", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  const codes: string[] = [];
  const off = engine.errors.on((payload) => {
    codes.push(payload.code);
  });
  const destroyed: number[] = [];
  engine.hooks.hook("entity:destroy", () => {
    destroyed.push(1);
  });
  const plugin = definePlugin(() => ({
    name: "setup-destroy",
    setup(setupEngine) {
      const host = setupEngine as GwenEngine;
      host.destroyEntity(host.createEntity());
    },
  }));
  try {
    await engine.use(plugin());
    expect(destroyed).toEqual([1]);
    expect(codes).toEqual([]);
  } finally {
    off();
  }
});

it("::a plugin provide on the setup engine fires service:provided", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  const codes: string[] = [];
  const off = engine.errors.on((payload) => {
    codes.push(payload.code);
  });
  const keys: string[] = [];
  engine.hooks.hook("service:provided", (event) => {
    keys.push(String(event.key));
  });
  const plugin = definePlugin({ provides: ["hookname:svc"] }, () => ({
    name: "setup-provide",
    setup(setupEngine) {
      setupEngine.provide("hookname:svc", { n: 1 });
    },
  }));
  try {
    await engine.use(plugin());
    expect(keys).toEqual(["hookname:svc"]);
    expect(codes).toEqual([]);
  } finally {
    off();
  }
});

it("::a nested plugin hook is removed when the parent plugin is unused", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const engine = await openEngine();
  const seen: number[] = [];
  const child = definePlugin(() => ({
    name: "tracked-child",
    setup(host) {
      host.hooks.hook("child:ping" as GwenRuntimeHookName, () => {
        seen.push(1);
      });
    },
  }));
  const parent = definePlugin(() => ({
    name: "tracked-parent",
    async setup(host) {
      await (host as GwenEngine).use(child());
    },
  }));
  await expect(engine.use(parent())).resolves.toBeUndefined();
  await engine.unuse("tracked-parent");
  engine.hooks.callHook("child:ping" as GwenRuntimeHookName);
  expect(seen).toEqual([]);
});
