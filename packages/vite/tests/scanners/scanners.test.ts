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
  type LayoutName,
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
});
