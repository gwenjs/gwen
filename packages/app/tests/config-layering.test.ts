import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineGwenModule, type GwenModule } from "@gwenjs/kit/module";
import { checkEngineConfig, ENGINE_DEFAULTS, formatReceived } from "@gwenjs/schema";
import type { GwenConfigIssue } from "@gwenjs/schema";
import { GwenApp } from "../src/app.js";
import { resolveGwenConfig } from "../src/config.js";
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
  it("a .env file and $test block are not applied", async () => {
    expect(failure(await load("export default {\n")).code).toBe("APP:CONFIG_LOAD_FAILED");
    const loaded = await load(js(""));
    const empty = engineOf(loaded);
    const keys = "maxEntities targetFPS maxDeltaSeconds loop physicsHz maxCatchupSteps debug".split(
      " ",
    );
    for (const key of keys)
      expect(empty[key]).toBe(ENGINE_DEFAULTS[key as keyof typeof ENGINE_DEFAULTS]);
    const full = loaded as { modules: unknown[]; logger: { minLevel: string } };
    expect([empty.variant, full.modules, full.logger.minLevel]).toEqual(["light", [], "warn"]);
    const dir = writeConfig(js("engine: { maxEntities: 40 }"));
    expect(await resolveGwenConfig(dir)).toEqual(await resolveGwenConfig(dir));
    const left = engineOf(await load(js("engine: { maxEntities: 11 }"))).maxEntities;
    const right = engineOf(await load(js("engine: { maxEntities: 22 }"))).maxEntities;
    expect([left, right]).toEqual([11, 22]);
    const body =
      "engine: { maxEntities: Number(process.env.GWEN_L61_ENTITIES ?? 50) }, $test: { engine: { maxEntities: 7 } }";
    const result = await load(js(body), "GWEN_L61_ENTITIES=9\n");
    expect([failure(result).code, engineOf(result).maxEntities]).toEqual([undefined, 50]);
  });
});
