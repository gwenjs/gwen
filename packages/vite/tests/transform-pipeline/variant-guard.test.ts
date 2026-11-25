/**
 * `gwen:variant-guard` raises `VITE:VARIANT_REQUIRED` for a value import of a variant package.
 * Fixtures under tests/fixtures/variant-guard/<case>/ end with one `// offender` line:
 * every allowed form comes first, so a guard that flags one of them moves the error line.
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectCoreVariant } from "@gwenjs/core/internal";
import { build, createServer, type ConfigEnv, type Plugin, type PluginOption } from "vite";
import type { ViteDevServer } from "vite";
import { expect, it } from "vitest";
import { gwen } from "../../src/index.js";
import { gwenVitePlugin } from "../../src/plugins/index.js";
import type { GwenTransformPipelineApi } from "../../src/pipeline/transform-pipeline.js";
import {
  createVariantGuard,
  VARIANT_PACKAGES,
  variantOfPackage,
  type VariantGuardOptions,
} from "../../src/transforms/variant-guard.js";
import {
  applyTransform,
  fixtureCase,
  openPipeline,
  preparePipeline,
  runPipeline,
} from "./helpers.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const guardFixtures = fileURLToPath(new URL("../fixtures/variant-guard/", import.meta.url));
const CODE = "VITE:VARIANT_REQUIRED";
const serveEnv: ConfigEnv = { command: "serve", mode: "development" };

type GuardConfig = Pick<VariantGuardOptions, "variant" | "declaredModules">;

/** Default 2D project. Two cases carry their own config. */
function guardConfig(name: string): GuardConfig {
  if (name === "undeclared-2d-in-2d") return { variant: "physics2d", declaredModules: [] };
  if (name === "light-imports-2d") return { variant: "light", declaredModules: [] };
  return { variant: "physics2d", declaredModules: ["@gwenjs/physics2d"] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * True when the error, a cause up the chain, or an entry of an aggregate `errors` list
 * (the shape `build()` rejects with) carries `code`.
 */
function reachesCode(error: unknown, code: string, seen: Set<unknown> = new Set()): boolean {
  if (!isRecord(error) || seen.has(error)) return false;
  seen.add(error);
  if (error["code"] === code) return true;
  if (reachesCode(error["cause"], code, seen)) return true;
  const errors = error["errors"];
  if (!Array.isArray(errors)) return false;
  return errors.some((item: unknown) => reachesCode(item, code, seen));
}

/** Vite hands the plugin error over as a plain object, so read the field, not the class. */
function messageOf(error: unknown): string {
  if (!isRecord(error)) return "";
  const message = error["message"];
  return typeof message === "string" ? message : "";
}

function isApi(value: unknown): value is GwenTransformPipelineApi {
  if (typeof value !== "object" || value === null) return false;
  if (!("register" in value) || typeof value.register !== "function") return false;
  return "names" in value;
}

function findPipeline(
  option: PluginOption,
): (Plugin & { api: GwenTransformPipelineApi }) | undefined {
  if (option === null || option === undefined || option === false || option instanceof Promise) {
    return undefined;
  }
  if (Array.isArray(option)) {
    for (const item of option) {
      const found = findPipeline(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (option.name !== "gwen:transform-pipeline") return undefined;
  if (!("api" in option)) return undefined;
  const api: unknown = option.api;
  if (!isApi(api)) return undefined;
  return Object.assign(option, { api });
}

function countOf(names: readonly string[], name: string): number {
  return names.filter((item) => item === name).length;
}

interface ConfigHook {
  (this: void, config: { root: string }, env: ConfigEnv): Promise<unknown>;
}

async function runConfig(owned: readonly Plugin[], root: string): Promise<void> {
  const main = owned.find((plugin) => plugin.name === "gwen");
  if (main === undefined) throw new Error("gwen() has no main plugin");
  const hook = main.config;
  if (typeof hook !== "function") throw new Error("config hook missing");
  await (hook as ConfigHook)({ root }, serveEnv);
}

function writeProject(root: string, config: string): void {
  writeFileSync(join(root, "gwen.config.ts"), config);
}

/**
 * A package the app can load (`resolveModuleEntry` reads its `./module` export)
 * and Vite can resolve, so an import the guard lets through does not fail on resolution.
 */
function writeModule(root: string, name: string): void {
  const dir = join(root, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ type: "module", exports: { ".": "./index.js", "./module": "./index.js" } }),
  );
  writeFileSync(
    join(dir, "index.js"),
    `export const useRaycast = () => 0;\nexport default { meta: { name: ${JSON.stringify(name)} }, setup() {} };\n`,
  );
}

function writeSource(root: string, file: string, source: string): string {
  const abs = join(root, file);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

/** `realpathSync`: on macOS Vite sees `/private/var/...` for a temp dir under `/var/...`. */
async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gwen-variant-guard-")));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const RAYCAST_3D =
  'import { useRaycast } from "@gwenjs/physics3d";\nexport const r = useRaycast;\n';
const BODY_2D =
  'import { useDynamicBody } from "@gwenjs/physics2d";\nexport const b = useDynamicBody;\n';

it("VARIANT_PACKAGES lists exactly the packages detectCoreVariant maps to a variant", () => {
  expect(VARIANT_PACKAGES).toEqual({
    "@gwenjs/physics2d": "physics2d",
    "@gwenjs/physics3d": "physics3d",
  });
  for (const [name, variant] of Object.entries(VARIANT_PACKAGES)) {
    expect(detectCoreVariant({ modules: [name] }), name).toBe(variant);
  }
  expect(detectCoreVariant({ modules: [] })).toBe("light");
  for (const [name, variant] of Object.entries(VARIANT_PACKAGES)) {
    expect(variantOfPackage(name), name).toBe(variant);
    expect(variantOfPackage(`${name}/module`), `${name}/module`).toBe(variant);
  }
  expect(variantOfPackage("@gwenjs/physics3d/module")).toBe("physics3d");
  expect(variantOfPackage("@gwenjs/physics3d-fracture")).toBeNull();
  expect(variantOfPackage("@gwenjs/physics3dx")).toBeNull();
  expect(variantOfPackage("vite")).toBeNull();
});

const caseNames = readdirSync(guardFixtures, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

// An empty discovery would register no position test and stay green on nothing.
if (caseNames.length === 0)
  throw new Error(`No variant-guard fixture cases under ${guardFixtures}`);

for (const name of caseNames) {
  it(`${name} raises at its offender line and at no earlier import`, async () => {
    const dir = join(guardFixtures, name);
    const fixture = fixtureCase(dir);
    const lines = fixture.input.split("\n");
    const marked = lines.filter((line) => line.includes("// offender"));
    expect(marked.length).toBe(1);
    const line = lines.findIndex((text) => text.includes("// offender")) + 1;
    const guard = createVariantGuard({ root: packageRoot, ...guardConfig(name) });
    await expect(
      runPipeline(fixture.input, { id: join(dir, "input.ts"), root: packageRoot, units: [guard] }),
    ).rejects.toMatchObject({ code: CODE, loc: { line } });
  });
}

it("a value import in gwen.config.ts raises like any project file", async () => {
  const id = join(packageRoot, "gwen.config.ts");
  const guard = createVariantGuard({
    root: packageRoot,
    variant: "physics2d",
    declaredModules: [],
  });
  const source = `${BODY_2D}export default { modules: [] };\n`;
  await expect(
    runPipeline(source, { id, root: packageRoot, units: [guard] }),
  ).rejects.toMatchObject({ code: CODE, loc: { file: id } });
});

it("a module outside the project root is not checked while the same import inside it is", async () => {
  const guard = createVariantGuard({
    root: packageRoot,
    variant: "physics2d",
    declaredModules: [],
  });
  const plugin = await openPipeline({ root: packageRoot, units: [guard] });
  // Shares the prefix of the root: `packages/vite-other` is not under `packages/vite`.
  const outside = join(`${resolve(packageRoot)}-other`, "a.ts");
  await expect(applyTransform(plugin, BODY_2D, outside)).resolves.toBeNull();
  const inside = join(packageRoot, "src", "a.ts");
  await expect(applyTransform(plugin, BODY_2D, inside)).rejects.toMatchObject({
    code: CODE,
    loc: { file: inside },
  });
  // A module id may carry a query: the message names the importer without it.
  await expect(applyTransform(plugin, BODY_2D, `${inside}?t=1`)).rejects.toMatchObject({
    code: CODE,
    message: expect.not.stringContaining("?t=1"),
  });
});

it("a project root reached through a symlink still guards the real paths of its modules", async () => {
  await withRoot(async (holder) => {
    const real = join(holder, "real");
    const link = join(holder, "link");
    mkdirSync(real);
    symlinkSync(real, link, "dir");
    const guard = createVariantGuard({ root: link, variant: "physics2d", declaredModules: [] });
    const id = join(real, "src", "a.ts");
    await expect(runPipeline(BODY_2D, { id, root: real, units: [guard] })).rejects.toMatchObject({
      code: CODE,
      loc: { file: id },
    });
  });
});

it("modules with only allowed imports come back with no edit and one more value import rejects them", async () => {
  const allowed = [
    'import { useDynamicBody } from "@gwenjs/physics2d";',
    'import type { Body } from "@gwenjs/physics3d";',
    'import { type Shape } from "@gwenjs/physics3d";',
    'import { tint } from "@gwenjs/renderer-core";',
    "export const b = useDynamicBody;",
    "export type T = [Body, Shape];",
    "export const t = tint;",
    "const local = 1;",
    "export { local };",
    "",
  ].join("\n");
  const guard = createVariantGuard({
    root: packageRoot,
    variant: "physics2d",
    declaredModules: ["@gwenjs/physics2d"],
  });
  const id = join(packageRoot, "src", "ok.ts");
  const units = [guard];
  await expect(runPipeline(allowed, { id, root: packageRoot, units })).resolves.toBeNull();
  const faulty = `${allowed}import { useRaycast } from "@gwenjs/physics3d";\nexport const r = useRaycast;\n`;
  await expect(runPipeline(faulty, { id, root: packageRoot, units })).rejects.toMatchObject({
    code: CODE,
  });
});

it("gwen() registers gwen:variant-guard once after its config hook and gwenVitePlugin() never does", async () => {
  await withRoot(async (root) => {
    writeProject(root, "export default { modules: [] };\n");
    const owned = gwen();
    const pipeline = findPipeline(owned);
    if (pipeline === undefined) throw new Error("gwen() has no pipeline");
    expect(pipeline.api.names).not.toContain("gwen:variant-guard");
    await runConfig(owned, root);
    expect(countOf(pipeline.api.names, "gwen:variant-guard")).toBe(1);
    const bare = findPipeline(gwenVitePlugin());
    if (bare === undefined) throw new Error("gwenVitePlugin() has no pipeline");
    expect(bare.api.names).not.toContain("gwen:variant-guard");
  });
});

it("the guard of gwen() takes the variant and the modules from the resolved config", async () => {
  await withRoot(async (declared) => {
    writeProject(declared, 'export default { modules: ["@gwenjs/physics2d"] };\n');
    writeModule(declared, "@gwenjs/physics2d");
    const owned = gwen();
    const pipeline = findPipeline(owned);
    if (pipeline === undefined) throw new Error("gwen() has no pipeline");
    await runConfig(owned, declared);
    await preparePipeline(pipeline, undefined, declared);
    const id = join(declared, "src", "a.ts");
    await expect(applyTransform(pipeline, BODY_2D, id)).resolves.toBeNull();
    await expect(applyTransform(pipeline, RAYCAST_3D, id)).rejects.toMatchObject({
      code: CODE,
      message: expect.stringContaining("physics3d"),
    });
  });
  await withRoot(async (undeclared) => {
    writeProject(undeclared, 'export default { modules: [], engine: { variant: "physics2d" } };\n');
    const owned = gwen();
    const pipeline = findPipeline(owned);
    if (pipeline === undefined) throw new Error("gwen() has no pipeline");
    await runConfig(owned, undeclared);
    await preparePipeline(pipeline, undefined, undeclared);
    const id = join(undeclared, "src", "a.ts");
    await expect(applyTransform(pipeline, BODY_2D, id)).rejects.toMatchObject({
      code: CODE,
      message: expect.stringContaining('"@gwenjs/physics2d" is not in modules'),
    });
  });
  // A light project: only the resolved variant tells the 2D import it has the wrong build.
  await withRoot(async (light) => {
    writeProject(light, "export default { modules: [] };\n");
    const owned = gwen();
    const pipeline = findPipeline(owned);
    if (pipeline === undefined) throw new Error("gwen() has no pipeline");
    await runConfig(owned, light);
    await preparePipeline(pipeline, undefined, light);
    const id = join(light, "src", "a.ts");
    await expect(applyTransform(pipeline, BODY_2D, id)).rejects.toMatchObject({
      code: CODE,
      message: expect.stringContaining(
        'which needs the "physics2d" variant; the build is "light".',
      ),
    });
  });
});

function rejectsWithGuard(error: unknown): boolean {
  if (!reachesCode(error, CODE)) return false;
  if (!messageOf(error).includes("physics3d")) return false;
  return messageOf(error).includes("src/bad.ts");
}

it("the guard raises in serve and in build", async () => {
  await withRoot(async (root) => {
    writeProject(root, 'export default { modules: ["@gwenjs/physics2d"] };\n');
    writeModule(root, "@gwenjs/physics2d");
    writeModule(root, "@gwenjs/physics3d");
    const bad = writeSource(root, "src/bad.ts", RAYCAST_3D);
    let server: ViteDevServer | undefined;
    try {
      server = await createServer({
        configFile: false,
        root,
        plugins: [gwen()],
        server: { middlewareMode: true, hmr: false },
        logLevel: "silent",
      });
      await expect(server.transformRequest("/src/bad.ts")).rejects.toSatisfy(rejectsWithGuard);
    } finally {
      await server?.close();
    }
    const building = build({
      configFile: false,
      root,
      plugins: [gwen()],
      logLevel: "silent",
      build: { write: false, rollupOptions: { input: bad } },
    });
    await expect(building).rejects.toSatisfy(rejectsWithGuard);
  });
});
