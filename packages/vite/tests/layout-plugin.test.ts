import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ViteErrorCodes } from "../src/error-codes.js";
import {
  generateLayoutsModule,
  extractLayoutNames,
  gwenLayoutPlugin,
} from "../src/plugins/layout.js";

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

describe("extractLayoutNames", () => {
  it("extracts layout names from const declarations", () => {
    const code = `const Level1 = defineLayout(() => {});`;
    const names = extractLayoutNames(code);

    expect(names).toContain("Level1");
    expect(names.size).toBe(1);
  });

  it("extracts multiple layout names from the same file", () => {
    const code = `
      const Level1 = defineLayout(() => {});
      const Level2 = defineLayout(() => {});
    `;
    const names = extractLayoutNames(code);

    expect(names).toContain("Level1");
    expect(names).toContain("Level2");
    expect(names.size).toBe(2);
  });

  it("extracts layout names with export keyword", () => {
    const code = `export const Level1 = defineLayout(() => {});`;
    const names = extractLayoutNames(code);

    expect(names).toContain("Level1");
  });

  it("handles multiline defineLayout calls", () => {
    const code = `
      export const ComplexLayout = defineLayout(
        () => {
          return { width: 100 };
        }
      );
    `;
    const names = extractLayoutNames(code);

    expect(names).toContain("ComplexLayout");
  });

  it("returns empty set when no defineLayout found", () => {
    const code = `const x = 1;`;
    const names = extractLayoutNames(code);

    expect(names.size).toBe(0);
  });

  it("ignores non-layout definitions", () => {
    const code = `
      const defineLayout = () => {};
      const Level1 = defineLayout(() => {});
      const someOtherVar = something();
    `;
    const names = extractLayoutNames(code);

    expect(names).toContain("Level1");
    expect(names.size).toBe(1);
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

  it("load throws VITE:TRANSFORM_PARSE_FAILED for an unparsable layout file", () => {
    const dir = join(root, "src", "layouts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.ts"), "export const L = defineLayout(() => { const = ; });\n");

    const plugin = gwenLayoutPlugin({
      layout: { include: ["src/layouts/**/*.ts"] },
      autoImports: [{ name: "defineLayout", from: "@gwenjs/core/actor" }],
    });
    const configResolved = plugin.configResolved;
    expect(typeof configResolved).toBe("function");
    if (typeof configResolved !== "function") return;
    Reflect.apply(configResolved, plugin, [{ root }]);

    const resolveId = plugin.resolveId;
    expect(typeof resolveId).toBe("function");
    if (typeof resolveId !== "function") return;
    const resolved: unknown = Reflect.apply(resolveId, plugin, ["virtual:gwen/layouts"]);
    expect(typeof resolved).toBe("string");
    if (typeof resolved !== "string") return;

    const load = plugin.load;
    expect(typeof load).toBe("function");
    if (typeof load !== "function") return;
    const outcome = outcomeOf(() => {
      const value: unknown = Reflect.apply(load, plugin, [resolved]);
      return value;
    });
    expect(isFailure(outcome) ? outcome.code : undefined).toBe(
      ViteErrorCodes.TRANSFORM_PARSE_FAILED,
    );
  });
});
