import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { FRAMEWORK_ENTRIES } from "@gwenjs/plugin-conformance";
import {
  FRAMEWORK_PROVIDES_KEYS,
  FRAMEWORK_TEST_ONLY_ENTRIES,
} from "../src/framework-entries.generated.js";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "../scripts/generate-framework-entries.mjs");
const committed = path.resolve(here, "../src/framework-entries.generated.ts");
const packagesDir = path.resolve(here, "../..");

/** Specifier, package directory, subpath of its snapshot: the ticket's allowed-import table. */
const EXPECTED: ReadonlyArray<readonly [string, string, string]> = [
  ["@gwenjs/schema", "schema", "."],
  ["@gwenjs/kit", "kit", "."],
  ["@gwenjs/kit/plugin", "kit", "./plugin"],
  ["@gwenjs/kit/module", "kit", "./module"],
  ["@gwenjs/core", "core", "."],
  ["@gwenjs/core/system", "core", "./system"],
  ["@gwenjs/core/actor", "core", "./actor"],
  ["@gwenjs/core/scene", "core", "./scene"],
  ["@gwenjs/core/tween", "core", "./tween"],
  ["@gwenjs/core/system/module", "core", "./system/module"],
  ["@gwenjs/core/actor/module", "core", "./actor/module"],
  ["@gwenjs/core/scene/module", "core", "./scene/module"],
  ["@gwenjs/core/router/module", "core", "./router/module"],
  ["@gwenjs/core/tween/module", "core", "./tween/module"],
  ["@gwenjs/core/testing", "core", "./testing"],
  ["@gwenjs/core/node", "core", "./node"],
  ["@gwenjs/math", "math", "."],
  ["@gwenjs/renderer-core", "renderer-core", "."],
  ["@gwenjs/renderer-core/module", "renderer-core", "./module"],
  ["@gwenjs/renderer-core/testing", "renderer-core", "./testing"],
  ["@gwenjs/camera-core", "camera-core", "."],
  ["@gwenjs/camera-core/module", "camera-core", "./module"],
];

type Snapshot = Record<string, { values: string[]; types: string[] }>;

interface Generated {
  readonly entries: Readonly<Record<string, readonly string[]>>;
  readonly testOnly: readonly string[];
  readonly provides: Readonly<Record<string, string>>;
}

function codePointSorted(names: Iterable<string>): string[] {
  return [...new Set(names)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

async function readSnapshot(directory: string): Promise<Snapshot> {
  const text = await readFile(path.join(packagesDir, directory, "public-api.snap.json"), "utf8");
  return JSON.parse(text) as Snapshot;
}

/** Transpile the generated TypeScript module and import it from a temp file. */
async function load(text: string, directory: string): Promise<Generated> {
  const output = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const file = path.join(directory, "generated.mjs");
  await writeFile(file, output.outputText);
  const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);
  return {
    entries: loaded.FRAMEWORK_ENTRIES as Generated["entries"],
    testOnly: loaded.FRAMEWORK_TEST_ONLY_ENTRIES as Generated["testOnly"],
    provides: loaded.FRAMEWORK_PROVIDES_KEYS as Generated["provides"],
  };
}

async function writeSnapshot(root: string, directory: string, snapshot: Snapshot): Promise<void> {
  await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(path.join(root, directory, "public-api.snap.json"), JSON.stringify(snapshot));
}

async function withTree<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "gwen-conformance-entries-"));
  try {
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function generate(root: string): Promise<Generated> {
  const { stdout } = await run(process.execPath, [script, "--stdout", "--packages", root]);
  return load(stdout, root);
}

/** A small framework tree: unsorted names, internal entries, no camera-core, no physics-core. */
async function writeTree(root: string): Promise<void> {
  await writeSnapshot(root, "schema", {
    ".": { values: ["zeta", "alpha"], types: ["Beta", "alpha"] },
  });
  await writeSnapshot(root, "core", {
    ".": { values: ["createEngine"], types: [] },
    "./system/module": { values: ["default"], types: [] },
    "./testing": { values: ["createRealEngine"], types: [] },
    "./internal": { values: ["secret"], types: [] },
    "./wasm/light": { values: ["wasmBytes"], types: [] },
    "./wasm/light/factory": { values: ["wasmFactory"], types: [] },
    "./node": { values: ["setupGwen"], types: [] },
  });
  await writeSnapshot(root, "renderer-core", {
    ".": { values: ["defineRenderer"], types: [] },
    "./testing": { values: ["fakeRenderer"], types: [] },
    "./internal": { values: ["hidden"], types: [] },
  });
  await mkdir(path.join(root, "schema/src"), { recursive: true });
  await writeFile(
    path.join(root, "schema/src/plugin.ts"),
    [
      "/**",
      " * @example",
      " * interface GwenProvides {",
      " *   fake: number;",
      " * }",
      " */",
      "export interface GwenProvides {",
      "  real: number;",
      '  "quoted:key": string;',
      "}",
      "",
    ].join("\n"),
  );
  await mkdir(path.join(root, "core/src"), { recursive: true });
  await writeFile(
    path.join(root, "core/src/augment.ts"),
    'declare module "@gwenjs/schema" {\n  interface GwenProvides {\n    fromCore: number;\n  }\n}\nexport {};\n',
  );
}

describe("framework entries", () => {
  it("matches the snapshots of the framework packages", async () => {
    const { stdout } = await run(process.execPath, [script, "--stdout"]);
    expect(stdout).toBe(await readFile(committed, "utf8"));

    expect(Object.keys(FRAMEWORK_ENTRIES).sort()).toEqual(
      EXPECTED.map(([specifier]) => specifier).sort(),
    );
    for (const [specifier, directory, subpath] of EXPECTED) {
      const entry = (await readSnapshot(directory))[subpath];
      expect(entry, `${directory} ${subpath} is in its snapshot`).toBeDefined();
      expect(FRAMEWORK_ENTRIES[specifier], specifier).toEqual(
        codePointSorted([...(entry?.values ?? []), ...(entry?.types ?? [])]),
      );
    }
    expect(FRAMEWORK_ENTRIES["@gwenjs/camera-core"]).toContain("CameraCorePlugin");
  });

  it("lists the test-only entries and the keys the framework already provides", () => {
    expect([...FRAMEWORK_TEST_ONLY_ENTRIES].sort()).toEqual([
      "@gwenjs/core/node",
      "@gwenjs/core/testing",
      "@gwenjs/renderer-core/testing",
    ]);
    expect(FRAMEWORK_PROVIDES_KEYS.cameraManager).toBe("@gwenjs/schema");
    expect(FRAMEWORK_PROVIDES_KEYS.physics2d).toBe("@gwenjs/physics2d");
    expect(FRAMEWORK_PROVIDES_KEYS["scene:registrar"]).toBe("@gwenjs/core");
    expect(FRAMEWORK_PROVIDES_KEYS["not-a-key"]).toBeUndefined();
  });

  it("sorts the names and merges values with types", async () => {
    await withTree(async (root) => {
      await writeTree(root);
      const generated = await generate(root);
      expect(generated.entries["@gwenjs/schema"]).toEqual(["Beta", "alpha", "zeta"]);
      expect(generated.entries["@gwenjs/core/system/module"]).toEqual(["default"]);
    });
  });

  it("leaves out internal and wasm entries and lists the test-only ones", async () => {
    await withTree(async (root) => {
      await writeTree(root);
      const generated = await generate(root);
      expect(Object.keys(generated.entries).sort()).toEqual([
        "@gwenjs/core",
        "@gwenjs/core/node",
        "@gwenjs/core/system/module",
        "@gwenjs/core/testing",
        "@gwenjs/renderer-core",
        "@gwenjs/renderer-core/testing",
        "@gwenjs/schema",
      ]);
      expect([...generated.testOnly].sort()).toEqual([
        "@gwenjs/core/node",
        "@gwenjs/core/testing",
        "@gwenjs/renderer-core/testing",
      ]);
    });
  });

  it("skips a package that has no snapshot without error", async () => {
    await withTree(async (root) => {
      await writeTree(root);
      const generated = await generate(root);
      const packages = Object.keys(generated.entries).map((specifier) =>
        specifier.split("/").slice(0, 2).join("/"),
      );
      expect(packages).toContain("@gwenjs/schema");
      expect(packages).not.toContain("@gwenjs/camera-core");
      expect(packages).not.toContain("@gwenjs/physics-core");
    });
  });

  it("reads GwenProvides keys from declarations, not from comments", async () => {
    await withTree(async (root) => {
      await writeTree(root);
      const generated = await generate(root);
      expect(generated.provides).toEqual({
        fromCore: "@gwenjs/core",
        real: "@gwenjs/schema",
        "quoted:key": "@gwenjs/schema",
      });
    });
  });

  it("writes the file given by --out and prints nothing", async () => {
    await withTree(async (root) => {
      await writeTree(root);
      const out = path.join(root, "nested/out.ts");
      const { stdout } = await run(process.execPath, [script, "--packages", root, "--out", out]);
      expect(stdout).toBe("");
      const printed = await run(process.execPath, [script, "--stdout", "--packages", root]);
      expect(await readFile(out, "utf8")).toBe(printed.stdout);
    });
  });
});
