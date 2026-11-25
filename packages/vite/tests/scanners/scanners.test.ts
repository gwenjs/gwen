import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AutoImport } from "@gwenjs/kit";
import { ViteErrorCodes } from "../../src/error-codes.js";
import {
  scanDefineHooks,
  scanEasingNames,
  scanLayoutNames,
  scanScenes,
  scanWasmModuleNames,
  type LayoutName,
  type WasmModuleScan,
} from "../../src/scanners/index.js";

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

function codeOf(outcome: Outcome<unknown>): string | undefined {
  return isFailure(outcome) ? outcome.code : undefined;
}

const SCENE_AUTO: readonly AutoImport[] = [{ name: "defineScene", from: "@gwenjs/core/scene" }];
const TWEEN_AUTO: readonly AutoImport[] = [{ name: "useTween", from: "@gwenjs/core/tween" }];

let root = "";
const roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gwen-scanners-"));
  roots.push(root);
});

afterEach(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  roots.length = 0;
});

function write(rel: string, source: string): string {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, source);
  return full;
}

function makeDir(rel: string): void {
  mkdirSync(join(root, rel), { recursive: true });
}

function sceneNames(outcome: Outcome<readonly { sceneName: string }[]>): string[] {
  return isFailure(outcome) ? [] : outcome.value.map((scene) => scene.sceneName);
}

function wasmNames(outcome: Outcome<WasmModuleScan>): string[] {
  return isFailure(outcome) ? [] : outcome.value.hits.map((hit) => hit.name);
}

function wasmSkips(outcome: Outcome<WasmModuleScan>): WasmModuleScan["skipped"] {
  return isFailure(outcome) ? [] : outcome.value.skipped;
}

const TYPE_A = 'import type { A } from "./a";';

describe("scanners", () => {
  it("scanScenes throws VITE:TRANSFORM_PARSE_FAILED on an unparsable scene file", () => {
    const file = write(
      "src/scenes/a.ts",
      'export const A = defineScene("a", () => { const = ; });\n',
    );
    const outcome = outcomeOf(() => scanScenes(root));
    expect(codeOf(outcome)).toBe(ViteErrorCodes.TRANSFORM_PARSE_FAILED);
    expect(isFailure(outcome) ? outcome.message.includes(file) : false).toBe(true);
  });

  it("scanScenes resolves a scene name through an aliased defineScene", () => {
    write(
      "src/scenes/menu.ts",
      'import { defineScene as ds } from "@gwenjs/core/scene";\nexport const Menu = ds("menu", () => {});\n',
    );
    const outcome = outcomeOf(() => scanScenes(root));
    expect(codeOf(outcome)).toBeUndefined();
    expect(sceneNames(outcome)).toEqual(["menu"]);
  });

  it("scanScenes resolves an auto-imported defineScene from the given autoImports", () => {
    write("src/scenes/menu.ts", 'export const Menu = defineScene("menu", () => {});\n');
    const without = outcomeOf(() => scanScenes(root));
    expect(codeOf(without)).toBe(ViteErrorCodes.SCENE_NAME_UNRESOLVED);
    const withOption = outcomeOf(() => scanScenes(root, { autoImports: SCENE_AUTO }));
    expect(sceneNames(withOption)).toEqual(["menu"]);
  });

  it("scanScenes does not take a defineScene from another package", () => {
    write(
      "src/scenes/other.ts",
      'import { defineScene } from "other-lib";\nexport const Other = defineScene("other", () => {});\n',
    );
    const outcome = outcomeOf(() => scanScenes(root));
    expect(codeOf(outcome)).toBe(ViteErrorCodes.SCENE_NAME_UNRESOLVED);
  });

  it("scanScenes raises VITE:TRANSFORM_PARSE_FAILED with a cause on a directory entry", () => {
    makeDir("src/scenes/folder.ts");
    const outcome = outcomeOf(() => scanScenes(root));
    expect(codeOf(outcome)).toBe(ViteErrorCodes.TRANSFORM_PARSE_FAILED);
    expect(isFailure(outcome) ? outcome.cause : undefined).toBeDefined();
  });

  it("scanDefineHooks returns exported consts only", () => {
    const file = write(
      "src/hooks.ts",
      'import { defineHooks } from "@gwenjs/core";\nexport const A = defineHooks({});\nconst B = defineHooks({});\n',
    );
    expect(scanDefineHooks(root)).toEqual([{ file, name: "A" }]);
  });

  it("scanDefineHooks reads an export list and an aliased defineHooks", () => {
    const file = write(
      "src/hooks.ts",
      'import { defineHooks as dh } from "@gwenjs/core";\nconst A = dh({});\nexport { A };\n',
    );
    expect(scanDefineHooks(root)).toEqual([{ file, name: "A" }]);
  });

  it("scanDefineHooks skips a default export and a string export name", () => {
    const file = write(
      "src/hooks.ts",
      [
        'import { defineHooks } from "@gwenjs/core";',
        "const A = defineHooks({});",
        "const B = defineHooks({});",
        "const C = defineHooks({});",
        'export { A, B as default, C as "x-y" };',
        "",
      ].join("\n"),
    );
    expect(scanDefineHooks(root)).toEqual([{ file, name: "A" }]);
  });

  it("scanDefineHooks reads src/hooks.ts then src/hooks/*.ts in sorted order and honours file and dir", () => {
    const main = write(
      "src/hooks.ts",
      'import { defineHooks } from "@gwenjs/core";\nexport const A = defineHooks({});\n',
    );
    const b = write(
      "src/hooks/b.ts",
      'import { defineHooks } from "@gwenjs/core";\nexport const B = defineHooks({});\n',
    );
    const a = write(
      "src/hooks/a.ts",
      'import { defineHooks } from "@gwenjs/core";\nexport const C = defineHooks({});\n',
    );
    expect(scanDefineHooks(root)).toEqual([
      { file: main, name: "A" },
      { file: a, name: "C" },
      { file: b, name: "B" },
    ]);

    const customFile = write(
      "src/x.ts",
      'import { defineHooks } from "@gwenjs/core";\nexport const X = defineHooks({});\n',
    );
    const customA = write(
      "src/h/a.ts",
      'import { defineHooks } from "@gwenjs/core";\nexport const H = defineHooks({});\n',
    );
    const customM = write(
      "src/h/m.ts",
      'import { defineHooks } from "@gwenjs/core";\nexport const M = defineHooks({});\n',
    );
    expect(scanDefineHooks(root, { file: "src/x.ts", dir: "src/h" })).toEqual([
      { file: customFile, name: "X" },
      { file: customA, name: "H" },
      { file: customM, name: "M" },
    ]);
  });

  it("scanDefineHooks throws VITE:TRANSFORM_PARSE_FAILED on an unparsable hooks file", () => {
    const file = write("src/hooks.ts", "export const A = defineHooks({ const = ; });\n");
    const outcome = outcomeOf(() => scanDefineHooks(root));
    expect(codeOf(outcome)).toBe(ViteErrorCodes.TRANSFORM_PARSE_FAILED);
    expect(isFailure(outcome) ? outcome.message.includes(file) : false).toBe(true);
  });

  it("scanDefineHooks raises VITE:TRANSFORM_PARSE_FAILED with a cause on a directory entry", () => {
    makeDir("src/hooks/x.ts");
    const outcome = outcomeOf(() => scanDefineHooks(root));
    expect(codeOf(outcome)).toBe(ViteErrorCodes.TRANSFORM_PARSE_FAILED);
    expect(isFailure(outcome) ? outcome.cause : undefined).toBeDefined();
  });

  it("scanLayoutNames resolves defineLayout under a namespace import", () => {
    const file = write(
      "src/layouts/l1.ts",
      'import * as A from "@gwenjs/core/actor";\nexport const L1 = A.defineLayout({})\n',
    );
    const found: LayoutName[] = scanLayoutNames(root, ["src/layouts/**/*.ts"]);
    expect(found).toEqual([{ name: "L1", file }]);
  });

  it("scanLayoutNames walks the include directories and returns each name with its file", () => {
    const a = write(
      "src/layouts/a.ts",
      'import { defineLayout } from "@gwenjs/core/actor";\nexport const A = defineLayout({})\n',
    );
    const b = write(
      "src/layouts/b.ts",
      'import { defineLayout } from "@gwenjs/core/actor";\nexport const B = defineLayout({})\n',
    );
    const nested = write(
      "src/nested.layout.ts",
      'import { defineLayout } from "@gwenjs/core/actor";\nexport const N = defineLayout({})\n',
    );
    const found = scanLayoutNames(root, ["src/layouts/**/*.ts", "src/**/*.layout.ts"]);
    expect(found).toEqual([
      { name: "A", file: a },
      { name: "B", file: b },
      { name: "N", file: nested },
    ]);
  });

  it("scanLayoutNames reads a .tsx layout file and a .spec.ts file but not a declaration or test file", () => {
    const hud = write(
      "src/layouts/hud.tsx",
      'import { defineLayout } from "@gwenjs/core/actor";\nexport const Hud = defineLayout({})\n',
    );
    const spec = write(
      "src/layouts/b.spec.ts",
      'import { defineLayout } from "@gwenjs/core/actor";\nexport const B = defineLayout({})\n',
    );
    write("src/layouts/types.d.ts", "export declare const x: ;\n");
    write("src/layouts/a.test.ts", "export const x = ;\n");
    write("src/layouts/a.test.tsx", "export const x = ;\n");
    const outcome = outcomeOf(() => scanLayoutNames(root, ["src/layouts/**/*.ts"]));
    expect(codeOf(outcome)).toBeUndefined();
    expect(isFailure(outcome) ? [] : outcome.value).toEqual([
      { name: "B", file: spec },
      { name: "Hud", file: hud },
    ]);
  });

  it("scanLayoutNames throws VITE:TRANSFORM_PARSE_FAILED on an unparsable layout file", () => {
    const file = write(
      "src/layouts/bad.ts",
      "export const L = defineLayout(() => { const = ; });\n",
    );
    const outcome = outcomeOf(() => scanLayoutNames(root, ["src/layouts/**/*.ts"]));
    expect(codeOf(outcome)).toBe(ViteErrorCodes.TRANSFORM_PARSE_FAILED);
    expect(isFailure(outcome) ? outcome.message.includes(file) : false).toBe(true);
  });

  it("scanLayoutNames raises VITE:TRANSFORM_PARSE_FAILED with a cause on a directory entry", () => {
    makeDir("src/layouts/x.ts");
    const outcome = outcomeOf(() => scanLayoutNames(root, ["src/layouts/**/*.ts"]));
    expect(codeOf(outcome)).toBe(ViteErrorCodes.TRANSFORM_PARSE_FAILED);
    expect(isFailure(outcome) ? outcome.cause : undefined).toBeDefined();
  });

  it("scanEasingNames ignores an easing key outside a tween call", () => {
    write(
      "src/motion.ts",
      'import { useTween } from "@gwenjs/core/tween";\nconst o = { easing: "linear" };\nuseTween({ duration: 1, easing: "easeInBack" });\n',
    );
    expect(scanEasingNames(root)).toEqual(["easeInBack"]);
  });

  it("scanEasingNames resolves an aliased and an auto-imported useTween", () => {
    write(
      "src/alias.ts",
      'import { useTween as tw } from "@gwenjs/core/tween";\ntw({ duration: 1, easing: "linear" });\n',
    );
    write("src/bare.ts", 'useTween({ duration: 1, easing: "easeInBack" });\n');
    expect(scanEasingNames(root, { autoImports: TWEEN_AUTO })).toEqual(["easeInBack", "linear"]);
  });

  it("scanEasingNames returns sorted unique string literals only", () => {
    write(
      "src/motion.ts",
      [
        'import { useTween } from "@gwenjs/core/tween";',
        'useTween({ duration: 1, easing: "easeInBack" });',
        'useTween({ duration: 1, easing: "easeInBack" });',
        "useTween({ duration: 1, easing: `easeOutQuad` });",
        'const name = "linear";',
        "useTween({ duration: 1, easing: name });",
        "",
      ].join("\n"),
    );
    expect(scanEasingNames(root)).toEqual(["easeInBack"]);
  });

  it("scanEasingNames skips declaration files and test files", () => {
    write("src/types.d.ts", "export declare const x: ;\n");
    write("src/motion.test.ts", "export const x = ;\n");
    write("src/motion.spec.ts", "export const x = ;\n");
    write("src/motion.ts", 'useTween({ duration: 1, easing: "easeInBack" });\n');
    const outcome = outcomeOf(() => scanEasingNames(root, { autoImports: TWEEN_AUTO }));
    expect(codeOf(outcome)).toBeUndefined();
    expect(isFailure(outcome) ? [] : outcome.value).toEqual(["easeInBack"]);
  });

  it("scanEasingNames throws VITE:TRANSFORM_PARSE_FAILED on an unparsable file", () => {
    const file = write("src/broken.ts", "export const x = ;\n");
    const outcome = outcomeOf(() => scanEasingNames(root));
    expect(codeOf(outcome)).toBe(ViteErrorCodes.TRANSFORM_PARSE_FAILED);
    expect(isFailure(outcome) ? outcome.message.includes(file) : false).toBe(true);
  });

  it("scanEasingNames raises VITE:TRANSFORM_PARSE_FAILED with a cause on a directory entry", () => {
    makeDir("src/bad.ts");
    const outcome = outcomeOf(() => scanEasingNames(root));
    expect(codeOf(outcome)).toBe(ViteErrorCodes.TRANSFORM_PARSE_FAILED);
    expect(isFailure(outcome) ? outcome.cause : undefined).toBeDefined();
  });

  it("scanWasmModuleNames returns the literal name, the importable type, the file and the line of engine.loadWasmModule<T>", () => {
    const file = write(
      "src/nav.ts",
      [
        'import type { NavExports } from "./nav-types";',
        'const url = "nav.wasm";',
        'engine.loadWasmModule<NavExports>({ name: "nav", url });',
        "",
      ].join("\n"),
    );
    const outcome = outcomeOf(() => scanWasmModuleNames(root, ["src"]));
    expect(isFailure(outcome) ? outcome : outcome.value).toEqual({
      hits: [
        { name: "nav", typeImport: { from: "./nav-types", name: "NavExports" }, file, line: 3 },
      ],
      skipped: [],
    });
  });

  it("scanWasmModuleNames matches useEngine().loadWasmModule, this.engine.loadWasmModule and an optional chain", () => {
    write(
      "src/shapes.ts",
      [
        TYPE_A,
        'useEngine().loadWasmModule<A>({ name: "a" });',
        "class Host {",
        '  start() { this.engine.loadWasmModule<A>({ name: "b" }); }',
        "}",
        'engine?.loadWasmModule<A>({ name: "c" });',
        "",
      ].join("\n"),
    );
    const outcome = outcomeOf(() => scanWasmModuleNames(root, ["src"]));
    expect(wasmNames(outcome)).toEqual(["a", "b", "c"]);
    expect(wasmSkips(outcome)).toEqual([]);
  });

  it("scanWasmModuleNames matches a destructured loadWasmModule, a renamed one, a parameter pattern, a default value and a binding declared after its use", () => {
    write(
      "src/pattern.ts",
      [
        TYPE_A,
        "const { loadWasmModule } = engine;",
        'loadWasmModule<A>({ name: "a" });',
        "const { loadWasmModule: load } = engine;",
        'load<A>({ name: "b" });',
        'function f({ loadWasmModule: lw }: Engine) { lw<A>({ name: "c" }); }',
        'function h() { const { loadWasmModule = fallback } = engine; loadWasmModule<A>({ name: "d" }); }',
        'function early() { late<A>({ name: "e" }); }',
        "const { loadWasmModule: late } = engine;",
        "",
      ].join("\n"),
    );
    const outcome = outcomeOf(() => scanWasmModuleNames(root, ["src"]));
    expect(wasmNames(outcome)).toEqual(["a", "b", "c", "d", "e"]);
    expect(wasmSkips(outcome)).toEqual([]);
  });

  it("scanWasmModuleNames does not match a local function named loadWasmModule, even one hoisted after its use", () => {
    write(
      "src/local.ts",
      [
        TYPE_A,
        "function loadWasmModule<T>(_options: { name: string }): void {}",
        'loadWasmModule<A>({ name: "local" });',
        'engine.loadWasmModule<A>({ name: "method" });',
        "",
      ].join("\n"),
    );
    write(
      "src/hoisted.ts",
      [
        TYPE_A,
        "const { loadWasmModule } = engine;",
        'loadWasmModule<A>({ name: "outer" });',
        "function g() {",
        '  loadWasmModule<A>({ name: "falsepos" });',
        "  function loadWasmModule(_options: { name: string }): void {}",
        "}",
        "",
      ].join("\n"),
    );
    const outcome = outcomeOf(() => scanWasmModuleNames(root, ["src"]));
    expect(wasmNames(outcome)).toEqual(["outer", "method"]);
    expect(wasmSkips(outcome)).toEqual([]);
  });

  it("scanWasmModuleNames does not see an aliased method, a call or apply, or a computed property", () => {
    write(
      "src/unseen.ts",
      [
        TYPE_A,
        "const f = engine.loadWasmModule;",
        'f<A>({ name: "alias" });',
        'engine.loadWasmModule.call(engine, { name: "call" });',
        'engine.loadWasmModule.apply(engine, [{ name: "apply" }]);',
        'engine["loadWasmModule"]<A>({ name: "computed" });',
        'Reflect.apply(engine.loadWasmModule, engine, [{ name: "reflect" }]);',
        "const { [loadWasmModule]: viaKey } = engine;",
        'viaKey<A>({ name: "keyed" });',
        'engine.loadWasmModule<A>({ name: "seen" });',
        "",
      ].join("\n"),
    );
    const outcome = outcomeOf(() => scanWasmModuleNames(root, ["src"]));
    expect(wasmNames(outcome)).toEqual(["seen"]);
    expect(wasmSkips(outcome)).toEqual([]);
  });

  it("scanWasmModuleNames records a non-literal name as skipped and keeps the other hits", () => {
    const file = write(
      "src/dynamic.ts",
      [
        TYPE_A,
        'const dynamic = "x";',
        "engine.loadWasmModule<A>({ name: dynamic });",
        'engine.loadWasmModule<A>({ name: "kept" });',
        "",
      ].join("\n"),
    );
    const outcome = outcomeOf(() => scanWasmModuleNames(root, ["src"]));
    expect(wasmSkips(outcome)).toEqual([{ file, line: 3, reason: "non-literal name" }]);
    expect(wasmNames(outcome)).toEqual(["kept"]);
  });

  it("scanWasmModuleNames skips a call whose type argument is absent, generic or not importable", () => {
    const file = write(
      "src/types.ts",
      [
        'import * as ns from "./ns";',
        'import type { G } from "./g";',
        "interface Local { f(): void }",
        'engine.loadWasmModule({ name: "a" });',
        'engine.loadWasmModule<Local>({ name: "b" });',
        'engine.loadWasmModule<{ f(): void }>({ name: "c" });',
        'engine.loadWasmModule<ns.T>({ name: "d" });',
        'engine.loadWasmModule<G<number>>({ name: "e" });',
        "",
      ].join("\n"),
    );
    const outcome = outcomeOf(() => scanWasmModuleNames(root, ["src"]));
    expect(wasmSkips(outcome)).toEqual([
      { file, line: 4, reason: "no type argument" },
      { file, line: 5, reason: "type not importable" },
      { file, line: 6, reason: "type not importable" },
      { file, line: 7, reason: "type not importable" },
      { file, line: 8, reason: "type not importable" },
    ]);
    expect(wasmNames(outcome)).toEqual([]);
  });

  it("scanWasmModuleNames keeps the original export name of an aliased type import and reads a default import", () => {
    const file = write(
      "src/imports.ts",
      [
        'import type { Nav as N } from "./nav";',
        'import type Def from "./def";',
        'engine.loadWasmModule<N>({ name: "a" });',
        'engine.loadWasmModule<Def>({ name: "b" });',
        "",
      ].join("\n"),
    );
    const outcome = outcomeOf(() => scanWasmModuleNames(root, ["src"]));
    expect(isFailure(outcome) ? outcome : outcome.value.hits).toEqual([
      { name: "a", typeImport: { from: "./nav", name: "Nav" }, file, line: 3 },
      { name: "b", typeImport: { from: "./def", name: "default" }, file, line: 4 },
    ]);
  });

  it("scanWasmModuleNames skips declaration, test and spec files and a node_modules directory", () => {
    const call = (name: string): string =>
      [TYPE_A, `engine.loadWasmModule<A>({ name: "${name}" });`, ""].join("\n");
    write("src/a.d.ts", call("dts"));
    write("src/a.test.ts", call("test"));
    write("src/a.spec.ts", call("spec"));
    write("src/node_modules/pkg/index.ts", call("x"));
    write("src/real.ts", call("real"));
    const outcome = outcomeOf(() => scanWasmModuleNames(root, ["src"]));
    expect(wasmNames(outcome)).toEqual(["real"]);
    expect(wasmSkips(outcome)).toEqual([]);
  });

  it("scanWasmModuleNames reads a file once when the given directories overlap and ignores an absent one", () => {
    write("src/plugins/p.ts", [TYPE_A, 'engine.loadWasmModule<A>({ name: "p" });', ""].join("\n"));
    const outcome = outcomeOf(() => scanWasmModuleNames(root, ["src", "src/plugins", "missing"]));
    expect(wasmNames(outcome)).toEqual(["p"]);
    expect(wasmSkips(outcome)).toEqual([]);
  });

  it("scanWasmModuleNames throws VITE:TRANSFORM_PARSE_FAILED on an unparsable file", () => {
    const file = write("src/broken.ts", "engine.loadWasmModule<A>({ name: ;\n");
    const outcome = outcomeOf(() => scanWasmModuleNames(root, ["src"]));
    expect(codeOf(outcome)).toBe(ViteErrorCodes.TRANSFORM_PARSE_FAILED);
    expect(isFailure(outcome) ? outcome.message.includes(file) : false).toBe(true);
  });

  it("scanWasmModuleNames raises VITE:TRANSFORM_PARSE_FAILED with a cause on a directory entry", () => {
    makeDir("src/folder.ts");
    const outcome = outcomeOf(() => scanWasmModuleNames(root, ["src"]));
    expect(codeOf(outcome)).toBe(ViteErrorCodes.TRANSFORM_PARSE_FAILED);
    expect(isFailure(outcome) ? outcome.cause : undefined).toBeDefined();
  });
});
