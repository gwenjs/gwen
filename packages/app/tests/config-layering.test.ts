import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineGwenModule, type GwenModule } from "@gwenjs/kit/module";
import { checkEngineConfig, ENGINE_DEFAULTS, formatReceived } from "@gwenjs/schema";
import type { GwenConfigIssue, GwenPlugin } from "@gwenjs/schema";
import { GwenApp } from "../src/app.js";
import { readConfigFile, resolveGwenConfig, resolveLoadedConfig } from "../src/config.js";
import { isPlainRecord, mergeLayers } from "../src/merge.js";
import type { ResolvedGwenConfig } from "../src/types.js";
import * as appResolve from "../src/resolve.js";

type Failure = { code?: string; message?: string; issues?: GwenConfigIssue[] };
const dirs: string[] = [];
let savedEntities: string | undefined;
beforeEach(() => {
  savedEntities = process.env.GWEN_L61_ENTITIES;
  delete process.env.GWEN_L61_ENTITIES;
});
afterEach(() => {
  if (savedEntities === undefined) delete process.env.GWEN_L61_ENTITIES;
  else process.env.GWEN_L61_ENTITIES = savedEntities;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});
function writeConfig(source: string, env?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gwen-p61-"));
  dirs.push(dir);
  writeFileSync(join(dir, "gwen.config.ts"), source);
  if (env !== undefined) writeFileSync(join(dir, ".env"), env);
  return dir;
}
const js = (body: string): string => `export default { ${body} };\n`;
const settle = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.catch((error: unknown) => error);
function failure(value: unknown): Failure {
  if (typeof value !== "object" || value === null) return {};
  return value as Failure;
}
async function load(source: string, env?: string): Promise<unknown> {
  return settle(resolveGwenConfig(writeConfig(source, env)));
}
function missing(name: string): never {
  throw new Error(`missing ${name}`);
}
async function boot(source: string, registry: Record<string, GwenModule>): Promise<unknown> {
  const loaded = await load(source);
  if (failure(loaded).code !== undefined) return loaded;
  const open = async (name: string): Promise<GwenModule> => registry[name] ?? missing(name);
  return settle(new GwenApp().setupModules(loaded as ResolvedGwenConfig, open));
}
const moduleOf = (name: string, configKey: string, extra: Partial<GwenModule> = {}): GwenModule =>
  defineGwenModule({ meta: { name, configKey }, setup() {}, ...extra });
const engineOf = (value: unknown) => (value as { engine: Record<string, unknown> }).engine;
const at = async (body: string): Promise<Failure> => failure(await load(js(body)));
const RAW =
  "maxEntities 1 y|maxEntities 0 n|maxEntities 2000000 y|maxEntities 2000001 n|targetFPS 1 y|targetFPS 0 n|targetFPS 300 y|targetFPS 301 n|maxDeltaSeconds 10 y|maxDeltaSeconds 0 n|maxDeltaSeconds 10.0001 n|loop internal y|loop fixed n|variant light y|variant nope n";
const ROWS = RAW.split("|");
describe("config layering", () => {
  it("resolve exports GwenAppConfigError", () => {
    expect(typeof appResolve.GwenAppConfigError).toBe("function");
  });
  it("engine field boundaries (maxEntities 1 / 0 / 2000000 / 2000001, targetFPS 1 / 0 / 300 / 301, maxDeltaSeconds 10 / 0 / 10.0001, loop internal / fixed, variant valid / invalid)", async () => {
    for (const row of ROWS) {
      const [field, raw, flag] = row.split(" ");
      const word = raw === "internal" || raw === "fixed" || raw === "light" || raw === "nope";
      const value = word ? raw : Number(raw);
      const ok = flag === "y";
      const probe = checkEngineConfig({ [field!]: value }, "@gwenjs/app", "engine.");
      const result = await load(js(`engine: { ${field}: ${JSON.stringify(value)} }`));
      const found = failure(result);
      if (ok) {
        expect(probe).toEqual([]);
        expect(found.code).toBeUndefined();
        expect(engineOf(result)[field!]).toEqual(value);
      } else {
        expect(found.code).toBe("APP:CONFIG_INVALID");
        expect(found.issues?.find((item) => item.path === `engine.${field}`)).toEqual(probe[0]);
      }
    }
  });
  it("targetFPS 500 is APP:CONFIG_INVALID with the core range", async () => {
    const want = checkEngineConfig({ targetFPS: 500 }, "@gwenjs/app", "engine.")[0];
    const found = await at("engine: { targetFPS: 500 }");
    expect(found.code).toBe("APP:CONFIG_INVALID");
    expect(found.issues?.find((item) => item.path === "engine.targetFPS")).toEqual(want);
    expect(found.message).toContain(
      `"engine.targetFPS" expected ${want?.expected}, received ${want?.received}`,
    );
  });
  it("loop fixed is APP:CONFIG_INVALID", async () => {
    const found = await at('engine: { loop: "fixed" }');
    expect(found.code).toBe("APP:CONFIG_INVALID");
    expect(found.issues?.some((item) => item.path === "engine.loop")).toBe(true);
  });
  it("several invalid fields give one error with every issue", async () => {
    const found = await at(
      'modules: [["@gwenjs/physics2d", { gravity: 1 }]], engine: { variant: "light", targetFPS: 500 }',
    );
    expect(found.issues?.map((item) => item.path).join()).toBe(
      "modules.0,engine.variant,engine.targetFPS",
    );
    expect(found.message?.split("\n").slice(1, -1)).toHaveLength(3);
  });
  it("several module-level issues give one error", async () => {
    let calls = 0;
    const setup = (): void => {
      calls += 1;
    };
    const reserved = moduleOf("@test/reserved", "engine", { setup });
    const data = moduleOf("@test/data", "data", { setup });
    const found = failure(
      await boot(
        js('modules: ["@test/reserved", "@test/data"], mystery: 1, data: { tick() { return 1; } }'),
        { "@test/reserved": reserved, "@test/data": data },
      ),
    );
    const paths = found.issues
      ?.map((item) => item.path)
      .sort()
      .join();
    expect(paths).toBe("data.tick,engine,mystery");
    expect(found.message?.split("\n").slice(1, -1)).toHaveLength(3);
    expect(calls).toBe(0);
  });
  it("physics2d module resolves variant physics2d", async () => {
    const explicit = await load(js('engine: { variant: "physics2d" }'));
    expect(failure(explicit).code).toBeUndefined();
    expect(engineOf(explicit).variant).toBe("physics2d");
    expect(engineOf(await load(js('modules: ["@gwenjs/physics2d"]'))).variant).toBe("physics2d");
  });
  it("physics2d module with variant light is APP:CONFIG_CONFLICT on engine.variant", async () => {
    const found = await at('modules: ["@gwenjs/physics2d"], engine: { variant: "light" }');
    expect(found.code).toBe("APP:CONFIG_CONFLICT");
    expect(found.issues?.find((item) => item.path === "engine.variant")?.conflictsWith).toBe(
      "@gwenjs/physics2d",
    );
    const both = await at(
      'modules: ["@gwenjs/physics2d", "@gwenjs/physics3d"], engine: { variant: "light" }',
    );
    expect(both.issues?.find((item) => item.path === "engine.variant")?.conflictsWith).toBe(
      "@gwenjs/physics3d",
    );
    const named = await load(js('plugins: [{ name: "Physics2D" }]'));
    expect(failure(named).code).toBeUndefined();
    expect(engineOf(named).variant).toBe("light");
  });
  it("reserved configKey is APP:CONFIG_CONFLICT", async () => {
    const mod = moduleOf("@test/reserved", "engine");
    const found = failure(await boot(js('modules: ["@test/reserved"]'), { "@test/reserved": mod }));
    expect(found.code).toBe("APP:CONFIG_CONFLICT");
    expect(found.issues?.find((item) => item.path === "engine")).toMatchObject({
      expected: "a configKey that is not reserved by gwen.config",
      received: '"engine" declared by module "@test/reserved"',
      owner: "@test/reserved",
      conflictsWith: "@gwenjs/app",
    });
  });
  it("two modules with one configKey name both owners", async () => {
    const first = moduleOf("@test/first", "shared");
    const second = moduleOf("@test/second", "shared");
    const owners = { "@test/first": first, "@test/second": second };
    const found = failure(await boot(js('modules: ["@test/first", "@test/second"]'), owners));
    expect(found.code).toBe("APP:CONFIG_CONFLICT");
    expect(found.issues?.find((item) => item.path === "shared")).toMatchObject({
      expected: "a configKey owned by one module",
      received: 'declared by "@test/first" and "@test/second"',
      owner: "@test/second",
      conflictsWith: "@test/first",
    });
    expect(found.message).toContain("@test/first");
    expect(found.message).toContain("@test/second");
  });
  it("unknown top-level key is APP:CONFIG_INVALID", async () => {
    const found = failure(await boot(js("mystery: 1"), {}));
    const issue = found.issues?.find((item) => item.path === "mystery");
    expect(found.code).toBe("APP:CONFIG_INVALID");
    expect(issue?.expected).toBe("a known top-level key");
    expect(issue?.owner).toBe("@gwenjs/app");
    expect(issue?.received).toBe(formatReceived(1));
  });
  it("tuple module entry is APP:CONFIG_INVALID", async () => {
    const found = await at('modules: [["@gwenjs/physics2d", { gravity: 1 }]]');
    const issue = found.issues?.find((item) => item.path === "modules.0");
    expect(found.code).toBe("APP:CONFIG_INVALID");
    expect(issue?.expected).toBe("a module name string");
    expect(issue?.owner).toBe("@gwenjs/app");
  });
  it("non-serializable module section is APP:CONFIG_INVALID at that path", async () => {
    const mod = moduleOf("@test/data", "data");
    const found = failure(
      await boot(js('modules: ["@test/data"], data: { tick() { return 1; } }'), {
        "@test/data": mod,
      }),
    );
    const issue = found.issues?.find((item) => item.path === "data.tick");
    expect(found.code).toBe("APP:CONFIG_INVALID");
    expect(issue?.expected).toBe("a JSON-serializable value");
    expect(issue?.received).toBe("[function]");
    expect(issue?.owner).toBe("@test/data");
  });
  it("module validate issues are prefixed by configKey", async () => {
    const bad = { path: "nested.gravity", expected: "a number", received: '"x"', owner: "raw" };
    const mod = moduleOf("@test/widget", "widget", { validate: () => [bad] });
    const found = failure(
      await boot(js('modules: ["@test/widget"], widget: { nested: { gravity: "x" } }'), {
        "@test/widget": mod,
      }),
    );
    const issue = found.issues?.find((item) => item.expected === "a number");
    expect([issue?.path, issue?.owner]).toEqual(["widget.nested.gravity", "@test/widget"]);
  });
  it("module default array is replaced by the user array", async () => {
    class SizeBox {
      readonly width = 8;
    }
    const box = new SizeBox();
    const onTick = (): string => "tick";
    let seen: Record<string, unknown> | undefined;
    const nested = { a: 1, b: 2 };
    const defaults = { tags: ["a", "b"], nested, keep: "default", extra: "default", box, onTick };
    const mod = moduleOf("@test/lists", "lists", {
      defaults,
      setup(options: Record<string, unknown>) {
        seen = options;
      },
    });
    const body =
      'modules: ["@test/lists"], lists: { tags: ["user"], nested: { a: 9 }, keep: undefined, extra: null }';
    const found = failure(await boot(js(body), { "@test/lists": mod }));
    expect(found.code).toBeUndefined();
    expect(seen?.tags).toEqual(["user"]);
    expect(seen?.nested).toEqual({ a: 9, b: 2 });
    expect(seen?.keep).toBe("default");
    expect(seen?.extra).toBeNull();
    expect(seen?.box).toBe(box);
    expect(seen?.onTick).toBe(onTick);
  });
  it("no physics module resolves variant light", async () => {
    expect(engineOf(await load(js(""))).variant).toBe("light");
    expect(engineOf(await load(js("modules: []"))).variant).toBe("light");
  });
  it("syntax error is APP:CONFIG_LOAD_FAILED", async () => {
    expect(failure(await load("export default {\n")).code).toBe("APP:CONFIG_LOAD_FAILED");
  });
  it("deep object merge keeps sibling defaults", async () => {
    let seen: Record<string, unknown> | undefined;
    const mod = moduleOf("@test/deep", "deep", {
      defaults: { nested: { a: 1, b: 2 } },
      setup(options: Record<string, unknown>) {
        seen = options;
      },
    });
    const found = failure(
      await boot(js('modules: ["@test/deep"], deep: { nested: { a: 9 } }'), { "@test/deep": mod }),
    );
    expect(found.code).toBeUndefined();
    expect(seen?.nested).toEqual({ a: 9, b: 2 });
  });
  it("undefined does not override a default and null does", async () => {
    let seen: Record<string, unknown> | undefined;
    const mod = moduleOf("@test/clear", "clear", {
      defaults: { keep: "default", extra: "default" },
      setup(options: Record<string, unknown>) {
        seen = options;
      },
    });
    const body = 'modules: ["@test/clear"], clear: { keep: undefined, extra: null }';
    const found = failure(await boot(js(body), { "@test/clear": mod }));
    expect(found.code).toBeUndefined();
    expect(seen?.keep).toBe("default");
    expect(seen?.extra).toBeNull();
  });
  it("resolveGwenConfig twice returns equal configs", async () => {
    const dir = writeConfig(js("engine: { maxEntities: 40 }"));
    expect(await resolveGwenConfig(dir)).toEqual(await resolveGwenConfig(dir));
  });
  it("empty config {} resolves to ENGINE_DEFAULTS", async () => {
    const loaded = await load(js(""));
    const empty = engineOf(loaded);
    const full = loaded as { modules: unknown[]; logger: { minLevel: string } };
    expect(failure(loaded).code).toBeUndefined();
    for (const key of Object.keys(ENGINE_DEFAULTS)) {
      expect(empty[key]).toBe(ENGINE_DEFAULTS[key as keyof typeof ENGINE_DEFAULTS]);
    }
    expect(full.modules).toEqual([]);
    expect(full.logger.minLevel).toBe("warn");
  });
  it("two directories keep their own maxEntities", async () => {
    const left = engineOf(await load(js("engine: { maxEntities: 11 }"))).maxEntities;
    const right = engineOf(await load(js("engine: { maxEntities: 22 }"))).maxEntities;
    expect([left, right]).toEqual([11, 22]);
  });
  it("a .env file and $development block are not applied", async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const body =
        "engine: { maxEntities: Number(process.env.GWEN_L61_ENTITIES ?? 50) }, $development: { engine: { maxEntities: 7 } }";
      const result = await load(js(body), "GWEN_L61_ENTITIES=9\n");
      expect([failure(result).code, engineOf(result).maxEntities]).toEqual([undefined, 50]);
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved;
    }
  });
  it("engine or logger that is not an object is APP:CONFIG_INVALID", async () => {
    const samples: Array<[string, unknown]> = [
      ["engine", null],
      ["engine", 5],
      ["engine", "abc"],
      ["engine", []],
      ["logger", null],
      ["logger", 3],
    ];
    for (const [key, value] of samples) {
      const raw = await load(js(`${key}: ${JSON.stringify(value)}`));
      const found = failure(raw);
      const issue = found.issues?.find((item) => item.path === key);
      expect(found.code).toBe("APP:CONFIG_INVALID");
      expect(issue?.expected).toBe("an object");
      expect(issue?.received).toBe(formatReceived(value));
      expect(issue?.owner).toBe("@gwenjs/app");
    }
  });
  it("a module section that is not an object is APP:CONFIG_INVALID", async () => {
    const samples: Array<[string, string, unknown, string]> = [
      ["tween: 5", "tween", 5, "@gwenjs/core:tween"],
      ["tween: []", "tween", [], "@gwenjs/core:tween"],
      ['tween: "x"', "tween", "x", "@gwenjs/core:tween"],
      ["tween: null", "tween", null, "@gwenjs/core:tween"],
    ];
    for (const [body, path, value, owner] of samples) {
      const raw = await boot(js(body), {});
      const found = failure(raw);
      const issue = found.issues?.find((item) => item.path === path);
      expect(found.code).toBe("APP:CONFIG_INVALID");
      expect(issue?.expected).toBe("an object");
      expect(issue?.received).toBe(formatReceived(value));
      expect(issue?.owner).toBe(owner);
    }
    let speed: unknown;
    const mod = moduleOf("@test/widget", "widget", {
      defaults: { speed: 2 },
      setup(options: Record<string, unknown>) {
        speed = options.speed;
      },
    });
    const found = failure(await boot(js('modules: ["@test/widget"]'), { "@test/widget": mod }));
    expect(found.code).toBeUndefined();
    expect(speed).toBe(2);
  });
  it("a module section set to false is APP:CONFIG_INVALID", async () => {
    const raw = await boot(js("tween: false"), {});
    const found = failure(raw);
    const issue = found.issues?.find((item) => item.path === "tween");
    expect(found.code).toBe("APP:CONFIG_INVALID");
    expect(issue?.expected).toBe("an object");
    expect(issue?.received).toBe(formatReceived(false));
    expect(issue?.owner).toBe("@gwenjs/core:tween");
  });
  it("engine + unknown key: two throws, each with its own issues", async () => {
    const first = failure(await load(js("engine: { targetFPS: 500 }, mystery: 1")));
    expect(first.code).toBe("APP:CONFIG_INVALID");
    expect(first.issues?.map((item) => item.path).join()).toBe("engine.targetFPS");
    const second = failure(await boot(js("mystery: 1"), {}));
    expect(second.code).toBe("APP:CONFIG_INVALID");
    expect(second.issues?.map((item) => item.path).join()).toBe("mystery");
  });
  it("kit.options is one deep-frozen object", async () => {
    let same = false;
    let kept = 0;
    let providerFrozen = true;
    let hookFrozen = true;
    let read = 0;
    const mod = defineGwenModule({
      meta: { name: "@test/opts" },
      setup(_options, gwen) {
        const first = gwen.options;
        same = first === gwen.options;
        const engine: unknown = Reflect.get(first, "engine");
        if (typeof engine === "object" && engine !== null) {
          Reflect.set(engine, "maxEntities", 1);
          const max: unknown = Reflect.get(engine, "maxEntities");
          kept = typeof max === "number" ? max : 0;
        }
        const screen: unknown = Reflect.get(first, "screen");
        const provider: unknown =
          typeof screen === "object" && screen !== null
            ? Reflect.get(screen, "sizeProvider")
            : undefined;
        providerFrozen =
          typeof provider === "object" && provider !== null && Object.isFrozen(provider);
        if (typeof provider === "object" && provider !== null) read = readBox(provider);
        const hooks: unknown = Reflect.get(first, "hooks");
        const hook: unknown =
          typeof hooks === "object" && hooks !== null
            ? Reflect.get(hooks, "build:before")
            : undefined;
        hookFrozen = typeof hook === "function" && Object.isFrozen(hook);
      },
    });
    const source = [
      "class Box { read() { return 4; } }",
      "const box = new Box();",
      "export default {",
      '  modules: ["@test/opts"],',
      "  engine: { maxEntities: 40 },",
      "  screen: { sizeProvider: box },",
      '  hooks: { "build:before"() {} },',
      "};",
    ].join("\n");
    const dir = writeConfig(source);
    const loaded = await resolveGwenConfig(dir);
    const open = async (name: string): Promise<GwenModule> =>
      name === "@test/opts" ? mod : missing(name);
    const found = failure(await settle(new GwenApp().setupModules(loaded, open)));
    expect(found.code).toBeUndefined();
    expect(loaded.engine.maxEntities).toBe(40);
    expect(kept).toBe(40);
    expect(same).toBe(true);
    expect(providerFrozen).toBe(false);
    expect(hookFrozen).toBe(false);
    expect(read).toBe(4);
    expect(Object.isFrozen(loaded)).toBe(false);
  });
  it("kit.options.plugins keeps the same plugin", async () => {
    const somePlugin: GwenPlugin = { name: "mine", setup() {} };
    const hooks = { "build:before"() {} };
    const vite: Record<string, unknown> = {};
    vite.port = 1;
    const file = "/app/gwen.config.ts";
    const loaded = resolveLoadedConfig(
      {
        modules: ["@test/ident"],
        plugins: [somePlugin],
        vite,
        hooks,
        engine: { maxEntities: 40 },
      },
      file,
    );
    let reads = 0;
    const mergedVite = loaded.vite;
    if (mergedVite === undefined) throw new Error("vite");
    Object.defineProperty(mergedVite, "port", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return 9;
      },
    });
    let seen: GwenPlugin | undefined;
    let viteSame = false;
    let hooksSame = false;
    let liveGetter = false;
    let engineFrozen = false;
    let kept = 0;
    let fileOnView = "";
    const mod = defineGwenModule({
      meta: { name: "@test/ident" },
      setup(_options, gwen) {
        const listed: unknown = Reflect.get(gwen.options, "plugins");
        const plugin: unknown =
          typeof listed === "object" && listed !== null ? Reflect.get(listed, 0) : undefined;
        if (isPlugin(plugin)) {
          seen = plugin;
          gwen.addPlugin(plugin);
        }
        viteSame = gwen.options.vite === mergedVite;
        hooksSame = gwen.options.hooks === loaded.hooks;
        const viewVite: unknown = gwen.options.vite;
        if (typeof viewVite === "object" && viewVite !== null) {
          const before = reads;
          const port: unknown = Reflect.get(viewVite, "port");
          liveGetter = reads === before + 1 && port === 9;
        }
        const engine: unknown = Reflect.get(gwen.options, "engine");
        engineFrozen = typeof engine === "object" && engine !== null && Object.isFrozen(engine);
        if (typeof engine === "object" && engine !== null) {
          Reflect.set(engine, "maxEntities", 1);
          const max: unknown = Reflect.get(engine, "maxEntities");
          kept = typeof max === "number" ? max : 0;
        }
        fileOnView = readConfigFile(gwen.options);
      },
    });
    const open = async (name: string): Promise<GwenModule> =>
      name === "@test/ident" ? mod : missing(name);
    const app = new GwenApp();
    const found = failure(await settle(app.setupModules(loaded, open)));
    expect(found.code).toBeUndefined();
    expect(seen).toBe(somePlugin);
    expect(app.plugins.find((item) => item.name === "mine")).toBe(somePlugin);
    expect(viteSame).toBe(true);
    expect(hooksSame).toBe(true);
    expect(liveGetter).toBe(true);
    expect(engineFrozen).toBe(true);
    expect(kept).toBe(40);
    expect(fileOnView).toBe(file);
  });
  it("an own __proto__ key does not change the prototype", () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"polluted":1}}');
    if (!isPlainRecord(parsed)) throw new Error("layer");
    try {
      const merged = mergeLayers({ tag: "low" }, parsed);
      expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
      expect(Reflect.get({}, "polluted")).toBeUndefined();
    } finally {
      Reflect.deleteProperty(Object.prototype, "polluted");
    }
  });
  it("a cyclic module section is APP:CONFIG_INVALID", async () => {
    const mod = moduleOf("@test/data", "data");
    const source = [
      'const data = { name: "loop" };',
      "data.self = data;",
      'export default { modules: ["@test/data"], data };',
    ].join("\n");
    const raw = await boot(source, { "@test/data": mod });
    const found = failure(raw);
    const issue = found.issues?.find((item) => item.path === "data.self");
    expect(found.code).toBe("APP:CONFIG_INVALID");
    expect(issue?.expected).toBe("a JSON-serializable value");
    expect(issue?.received).toBe("[circular]");
    expect(issue?.owner).toBe("@test/data");
  });
  it("undefined in an array is APP:CONFIG_INVALID", async () => {
    const mod = moduleOf("@test/data", "data");
    const source = 'export default { modules: ["@test/data"], data: { items: [undefined] } };\n';
    const found = failure(await boot(source, { "@test/data": mod }));
    const issue = found.issues?.find((item) => item.path === "data.items.0");
    expect(found.code).toBe("APP:CONFIG_INVALID");
    expect(issue?.expected).toBe("a JSON-serializable value");
    expect(issue?.received).toBe(formatReceived(undefined));
    expect(issue?.owner).toBe("@test/data");
  });
  it("empty configFile omits the parentheses", () => {
    const issue = {
      path: "engine",
      expected: "an object",
      received: "null",
      owner: "@gwenjs/app",
    };
    const empty = new appResolve.GwenAppConfigError("", [issue]);
    const named = new appResolve.GwenAppConfigError("/app/gwen.config.ts", [issue]);
    expect(empty.message.split("\n")[0]).toBe("[GWEN] Invalid gwen.config:");
    expect(named.message.split("\n")[0]).toBe("[GWEN] Invalid gwen.config (/app/gwen.config.ts):");
  });
});

function isPlugin(value: unknown): value is GwenPlugin {
  if (typeof value !== "object" || value === null) return false;
  const name: unknown = Reflect.get(value, "name");
  const setup: unknown = Reflect.get(value, "setup");
  return typeof name === "string" && typeof setup === "function";
}

function readBox(value: object): number {
  const method: unknown = Reflect.get(value, "read");
  if (typeof method !== "function") return 0;
  const result: unknown = Reflect.apply(method, value, []);
  return typeof result === "number" ? result : 0;
}
