import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ViteErrorCodes } from "../src/error-codes.js";
import { generateLayoutsModule, gwenLayoutPlugin } from "../src/plugins/layout.js";

describe("generateLayoutsModule", () => {
  it("returns empty layouts object when no files given", () => {
    const code = generateLayoutsModule(new Map());
    expect(code).toContain("export const layouts = {}");
  });

  it("generates lazy imports for each layout", () => {
    const layoutMap = new Map([
      ["Level1", "/project/src/layouts/level-1.ts"],
      ["DungeonFloor1", "/project/src/layouts/dungeon-floor-1.ts"],
    ]);
    const code = generateLayoutsModule(layoutMap);

    expect(code).toContain("import('/project/src/layouts/level-1.ts')");
    expect(code).toContain("import('/project/src/layouts/dungeon-floor-1.ts')");
    expect(code).toContain("'Level1':");
    expect(code).toContain("'DungeonFloor1':");
    expect(code).toContain("export const layouts = {");
  });

  it("generates correct number of entries", () => {
    const layoutMap = new Map([
      ["A", "/a.ts"],
      ["B", "/b.ts"],
      ["C", "/c.ts"],
    ]);
    const code = generateLayoutsModule(layoutMap);
    const matches = code.match(/import\(/g);
    expect(matches).toHaveLength(3);
  });

  it("properly formats the layouts object", () => {
    const layoutMap = new Map([["TestLayout", "/path/to/test.ts"]]);
    const code = generateLayoutsModule(layoutMap);

    expect(code).toMatch(/\{\s*'TestLayout':/);
    expect(code).toMatch(/\}\s*;/);
  });
});

type Failure = { code: string; message: string; cause: unknown };
type Outcome<T> = { value: T } | Failure;

function isFailure(outcome: Outcome<unknown>): outcome is Failure {
  return "code" in outcome;
}

function thrown(caught: unknown): Failure {
  if (typeof caught === "object" && caught !== null) {
    const code = "code" in caught ? caught.code : undefined;
    const message = "message" in caught ? caught.message : undefined;
    if (typeof code === "string" && typeof message === "string") {
      const cause = "cause" in caught ? caught.cause : undefined;
      return { code, message, cause };
    }
  }
  if (caught instanceof Error) {
    return { code: "", message: caught.message, cause: caught.cause };
  }
  return { code: "", message: "thrown value was not an Error", cause: undefined };
}

function outcomeOf<T>(run: () => T): Outcome<T> {
  try {
    return { value: run() };
  } catch (caught) {
    return thrown(caught);
  }
}

describe("gwenLayoutPlugin", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gwen-layout-plugin-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const AUTO = [{ name: "defineLayout", from: "@gwenjs/core/actor" }];

  function writeLayout(rel: string, source: string): string {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source);
    return full;
  }

  /** Runs `configResolved`, `resolveId` and `load` of the plugin against `root`. */
  function loadLayouts(plugin: Plugin): Outcome<unknown> {
    const configResolved = plugin.configResolved;
    expect(typeof configResolved).toBe("function");
    if (typeof configResolved !== "function") return thrown(undefined);
    Reflect.apply(configResolved, plugin, [{ root }]);

    const resolveId = plugin.resolveId;
    expect(typeof resolveId).toBe("function");
    if (typeof resolveId !== "function") return thrown(undefined);
    const resolved: unknown = Reflect.apply(resolveId, plugin, ["virtual:gwen/layouts"]);
    expect(typeof resolved).toBe("string");
    if (typeof resolved !== "string") return thrown(undefined);

    const load = plugin.load;
    expect(typeof load).toBe("function");
    if (typeof load !== "function") return thrown(undefined);
    return outcomeOf(() => {
      const value: unknown = Reflect.apply(load, plugin, [resolved]);
      return value;
    });
  }

  it("load returns a lazy import for a bare and an aliased defineLayout under src/layouts", () => {
    const aliased = writeLayout(
      "src/layouts/a.ts",
      'import { defineLayout as dl } from "@gwenjs/core/actor";\nexport const A = dl({});\n',
    );
    const bare = writeLayout("src/layouts/l.ts", "export const L = defineLayout({});\n");
    const plugin = gwenLayoutPlugin({
      layout: { include: ["src/layouts/**/*.ts"] },
      autoImports: AUTO,
    });
    const outcome = loadLayouts(plugin);
    expect(isFailure(outcome) ? undefined : outcome.value).toBe(
      `export const layouts = {\n  'A': () => import('${aliased}'),\n  'L': () => import('${bare}'),\n};\n`,
    );
  });

  it("load finds no layout for a bare defineLayout when autoImports is not given", () => {
    writeLayout("src/layouts/l.ts", "export const L = defineLayout({});\n");
    const plugin = gwenLayoutPlugin({ layout: { include: ["src/layouts/**/*.ts"] } });
    const outcome = loadLayouts(plugin);
    expect(isFailure(outcome) ? undefined : outcome.value).toBe("export const layouts = {};\n");
  });

  it("load throws VITE:TRANSFORM_PARSE_FAILED for an unparsable layout file", () => {
    writeLayout("src/layouts/bad.ts", "export const L = defineLayout(() => { const = ; });\n");
    const plugin = gwenLayoutPlugin({
      layout: { include: ["src/layouts/**/*.ts"] },
      autoImports: AUTO,
    });
    const outcome = loadLayouts(plugin);
    expect(isFailure(outcome) ? outcome.code : undefined).toBe(
      ViteErrorCodes.TRANSFORM_PARSE_FAILED,
    );
  });
});
