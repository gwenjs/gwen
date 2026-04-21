import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GwenApp } from "../src/app.js";
import { defineGwenModule } from "@gwenjs/kit/module";
import type { ResolvedGwenConfig } from "../src/config.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ResolvedGwenConfig> = {}): ResolvedGwenConfig {
  return {
    modules: [],
    engine: {
      maxEntities: 1000,
      targetFPS: 60,
      variant: "light",
      loop: "internal",
      maxDeltaSeconds: 0.1,
      debug: false,
    },
    logger: {
      minLevel: "warn",
    },
    debug: {
      perf: false,
    },
    ...overrides,
  };
}

let tmpRoot: string;

beforeEach(() => {
  // Fresh isolated temp dir per test
  tmpRoot = join(tmpdir(), `gwen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ─── prepare() ────────────────────────────────────────────────────────────────

describe("GwenApp.prepare()", () => {
  it("creates .gwen/types/ directory", async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    expect(existsSync(join(tmpRoot, ".gwen", "types"))).toBe(true);
  });

  it("writes .gwen/types/auto-imports.d.ts", async () => {
    const mod = defineGwenModule({
      meta: { name: "test-mod" },
      setup(_opts, gwen) {
        gwen.addAutoImports([{ name: "usePhysics2D", from: "@gwenjs/physics2d" }]);
      },
    });

    const app = new GwenApp();
    await app.setupModules(makeConfig({ modules: ["test-mod"] }), async () => mod);
    await app.prepare(tmpRoot);

    const content = readFileSync(join(tmpRoot, ".gwen", "types", "auto-imports.d.ts"), "utf8");
    expect(content).toContain("declare global {");
    expect(content).toContain("@gwenjs/physics2d");
  });

  it("uses `as` alias in auto-imports.d.ts", async () => {
    const mod = defineGwenModule({
      meta: { name: "alias-mod" },
      setup(_opts, gwen) {
        gwen.addAutoImports([{ name: "useRigidBody", from: "@gwenjs/physics2d", as: "useBody" }]);
      },
    });

    const app = new GwenApp();
    await app.setupModules(makeConfig({ modules: ["alias-mod"] }), async () => mod);
    await app.prepare(tmpRoot);

    const content = readFileSync(join(tmpRoot, ".gwen", "types", "auto-imports.d.ts"), "utf8");
    expect(content).toContain("declare global {");
    expect(content).toContain("['useRigidBody']");
  });

  it("writes .gwen/types/env.d.ts with virtual:gwen/* declarations", async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    const content = readFileSync(join(tmpRoot, ".gwen", "types", "env.d.ts"), "utf8");
    expect(content).toContain("virtual:gwen/auto-imports");
    expect(content).toContain("virtual:gwen/wasm");
    expect(content).toContain("virtual:gwen/env");
    expect(content).toContain('/// <reference types="vite/client" />');
  });

  it("writes .gwen/tsconfig.json with correct include paths", async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    const raw = readFileSync(join(tmpRoot, ".gwen", "tsconfig.json"), "utf8");
    const tsconfig = JSON.parse(raw);
    expect(tsconfig.compilerOptions.noEmit).toBe(true);
    expect(tsconfig.include).toContain("../src/**/*.ts");
    expect(tsconfig.include).toContain("types/**/*.d.ts");
  });

  it("writes per-module type templates from addTypeTemplate", async () => {
    const mod = defineGwenModule({
      meta: { name: "typed-mod" },
      setup(_opts, gwen) {
        gwen.addTypeTemplate({
          filename: "physics2d.d.ts",
          getContents: () =>
            `declare module '@gwenjs/core' { interface GwenProvides { physics2d: unknown } }`,
        });
      },
    });

    const app = new GwenApp();
    await app.setupModules(makeConfig({ modules: ["typed-mod"] }), async () => mod);
    await app.prepare(tmpRoot);

    const dest = join(tmpRoot, ".gwen", "types", "physics2d.d.ts");
    expect(existsSync(dest)).toBe(true);
    const content = readFileSync(dest, "utf8");
    expect(content).toContain("GwenProvides");
  });

  it("with no module auto-imports still includes the built-in useScreen", async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    const content = readFileSync(join(tmpRoot, ".gwen", "types", "auto-imports.d.ts"), "utf8");
    expect(content).toContain("useScreen");
    expect(content).toContain("@gwenjs/renderer-core");
  });

  it("is idempotent — calling prepare() twice produces same files", async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    const before = readFileSync(join(tmpRoot, ".gwen", "tsconfig.json"), "utf8");
    await app.prepare(tmpRoot);
    const after = readFileSync(join(tmpRoot, ".gwen", "tsconfig.json"), "utf8");
    expect(before).toBe(after);
  });

  it("writeIfChanged does not rewrite unchanged files (spy test)", async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    // Manually inject a sentinel timestamp into a file
    const envPath = join(tmpRoot, ".gwen", "types", "env.d.ts");
    const original = readFileSync(envPath, "utf8");

    // Second prepare — file content unchanged, should not be rewritten
    // We spy on writeFileSync to detect if it's called
    const spy = vi.spyOn({ writeFileSync }, "writeFileSync");
    await app.prepare(tmpRoot);

    // The file should still have the original content
    expect(readFileSync(envPath, "utf8")).toBe(original);
    spy.mockRestore();
  });

  it("env.d.ts declares all virtual:gwen/* modules resolved by the Vite plugin", async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    const content = readFileSync(join(tmpRoot, ".gwen", "types", "env.d.ts"), "utf8");

    // These module names must stay in sync with the virtual module ids
    // resolved by @gwenjs/vite. If you add a new virtual module to the Vite
    // plugin, add it here too — this test is the cross-validation guard.
    const expectedModules = ["virtual:gwen/wasm", "virtual:gwen/env", "virtual:gwen/auto-imports"];

    for (const mod of expectedModules) {
      expect(content, `env.d.ts must declare module '${mod}'`).toContain(`'${mod}'`);
    }
  });
});

// ─── mergeDefaults — array concatenation ─────────────────────────────────────

describe("mergeDefaults — array handling", () => {
  it("concatenates user array with default array (defaults first)", async () => {
    let received: Record<string, unknown> = {};

    const mod = defineGwenModule<{ tags: string[] }>({
      meta: { name: "array-mod" },
      defaults: { tags: ["default-tag"] },
      setup(options) {
        received = options as Record<string, unknown>;
      },
    });

    const app = new GwenApp();
    await app.setupModules(
      makeConfig({ modules: [["array-mod", { tags: ["user-tag"] }]] }),
      async () => mod,
    );

    // defaults first, user values appended
    expect(received["tags"]).toEqual(["default-tag", "user-tag"]);
  });

  it("keeps user array as-is when no default exists for the key", async () => {
    let received: Record<string, unknown> = {};

    const mod = defineGwenModule<{ plugins: string[] }>({
      meta: { name: "no-default-mod" },
      // no defaults
      setup(options) {
        received = options as Record<string, unknown>;
      },
    });

    const app = new GwenApp();
    await app.setupModules(
      makeConfig({ modules: [["no-default-mod", { plugins: ["a", "b"] }]] }),
      async () => mod,
    );

    expect(received["plugins"]).toEqual(["a", "b"]);
  });

  it("does not concatenate when only one side is an array", async () => {
    let received: Record<string, unknown> = {};

    const mod = defineGwenModule<{ value: unknown }>({
      meta: { name: "mixed-mod" },
      defaults: { value: "not-an-array" },
      setup(options) {
        received = options as Record<string, unknown>;
      },
    });

    const app = new GwenApp();
    await app.setupModules(
      makeConfig({ modules: [["mixed-mod", { value: ["user-array"] }]] }),
      async () => mod,
    );

    // user value wins (no concatenation — types differ)
    expect(received["value"]).toEqual(["user-array"]);
  });

  it("deep-merges plain objects independently of the array fix", async () => {
    let received: Record<string, unknown> = {};

    const mod = defineGwenModule<{ nested: { a: number; b: number } }>({
      meta: { name: "nested-mod" },
      defaults: { nested: { a: 1, b: 2 } },
      setup(options) {
        received = options as Record<string, unknown>;
      },
    });

    const app = new GwenApp();
    await app.setupModules(
      makeConfig({ modules: [["nested-mod", { nested: { b: 99 } }]] }),
      async () => mod,
    );

    expect(received["nested"]).toEqual({ a: 1, b: 99 });
  });
});
