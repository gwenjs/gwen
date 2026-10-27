import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createLogger, transformWithOxc, type Logger, type Plugin } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { gwenVitePlugin } from "../src/plugins/index.js";

declare const __GWEN_DEV__: boolean;

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** Joined so this file does not hold the core hint as one literal. */
const requirementHint = ["before the plugin that ", "requires it"].join("");

/**
 * Real hint phrases. Each occurs once under package src and is reached
 * only from a __GWEN_DEV__ branch (the context sentence via contextHint).
 * GwenPluginNotFoundError keeps the `}` of `${pluginName}` so the slice is
 * not the rendered sentence also written in an unbundled test.
 */
const REAL_HINTS = [
  "the GWEN Vite plugin restores the context",
  "Call engine.use(plugin) before spawn()",
  "pool.stats().peakActive",
  "recompile the plugin against the current gwen-wasm-utils",
  '}" plugin via engine.use() or in gwen.config.ts.',
  requirementHint,
];

/**
 * Named stand-ins. These classes are not in this tree, or their hint text is
 * not a single gated phrase: GwenPluginShapeError, GwenModuleDefinitionError,
 * GwenEngineStateError, GwenWasmError, GwenConfigError, GwenConfigLoadError.
 */
const STAND_IN_CLASSES = [
  "GwenPluginShapeError",
  "GwenModuleDefinitionError",
  "GwenEngineStateError",
  "GwenWasmError",
  "GwenConfigError",
  "GwenConfigLoadError",
];

const STAND_IN_TEXTS = STAND_IN_CLASSES.map((name) => `dev-only hint for ${name}`);

const SENTINELS = [
  ...REAL_HINTS,
  ...STAND_IN_TEXTS,
  "not available in local mode",
  "WASM core loaded",
  "exceeded 50% of frame budget",
  "WASM memory sentinel violation",
  "ownership transferred",
  "isolated after",
  "__routerName__",
  // The injector writes single quotes. Oxc reprints them as double quotes.
  '__layoutName__: "Level1"',
  "__GWEN_DEV__",
  "import.meta.env",
];

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function pickExport(exp: unknown): string | null {
  if (typeof exp === "string") return exp;
  if (!exp || typeof exp !== "object") return null;
  const record = exp as Record<string, unknown>;
  const value = record["import"] ?? record["default"] ?? record["require"];
  return typeof value === "string" ? value : null;
}

/**
 * The async-context plugin parses with acorn, which rejects `import type`.
 * Strip types before that plugin so the src fixture is JavaScript.
 */
function stripTypesForParser(): Plugin {
  return {
    name: "gwen-test-strip-types",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?", 1)[0] ?? id;
      if (!/\.[cm]?tsx?$/.test(file) || file.includes("node_modules")) return null;
      if (!code.includes("import type") && !code.includes("export type")) return null;
      const lang = file.endsWith("tsx") ? "tsx" : "ts";
      const result = await transformWithOxc(code, file, { lang });
      if (result.map === undefined) return { code: result.code };
      return { code: result.code, map: result.map };
    },
  };
}

/** Src runs load this class from source. The rest of `@gwenjs/core` stays on dist. */
const CORE_SRC_ENTRY = "\0gwen-core-src-entry";

function gwenAlias(mode: "src" | "dist"): Plugin {
  return {
    name: "gwen-src-or-dist",
    enforce: "pre",
    resolveId(id) {
      // The plugin-not-found hint lives in core source. Dist would hide a leak.
      if (mode === "src" && id === "@gwenjs/core") return CORE_SRC_ENTRY;
      if (!id.startsWith("@gwenjs/") || id.startsWith("@gwenjs/vite")) return null;
      const rest = id.slice("@gwenjs/".length);
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      const sub = slash === -1 ? "." : `.${rest.slice(slash)}`;
      const pkgDir = join(repoRoot, "packages", name);
      const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
        exports?: Record<string, unknown>;
        publishConfig?: { exports?: Record<string, unknown> };
      };
      const table = mode === "dist" ? (pkg.publishConfig?.exports ?? pkg.exports) : pkg.exports;
      const target = table ? pickExport(table[sub]) : null;
      if (!target) return null;
      // Kit's export map points at dist. The src run bundles packages/kit/src
      // so a context-hint edit is visible to the prod sentinel check.
      if (mode === "src" && name === "kit" && sub === ".") {
        const source = join(pkgDir, "src", "index.ts");
        if (existsSync(source)) return source;
      }
      return join(pkgDir, target);
    },
    load(id) {
      if (id !== CORE_SRC_ENTRY) return null;
      const dist = join(repoRoot, "packages/core/dist/index.js");
      const errors = join(repoRoot, "packages/core/src/engine/engine-errors.ts");
      return `export {
  createEngine,
  createEngineLocal,
  GwenActorError,
  GwenConfigError,
  GwenContextError,
  GwenWasmAbiError,
  useEngine,
} from ${JSON.stringify(dist)};
export { GwenPluginNotFoundError, GwenPluginDependencyError } from ${JSON.stringify(errors)};
`;
    },
  };
}

function writeFixture(dir: string): void {
  mkdirSync(join(dir, "src", "layouts"), { recursive: true });
  const hintText = `${STAND_IN_TEXTS.join(" ")} __GWEN_DEV__ import.meta.env`;
  writeFileSync(
    join(dir, "src", "main.ts"),
    `import { createEngine, GwenActorError, GwenContextError, GwenPluginDependencyError, GwenPluginNotFoundError, GwenWasmAbiError, useEngine } from "@gwenjs/core";
import { defineActor, PoolExhaustedError, useChildren } from "@gwenjs/core/actor";
import { Physics3DPlugin } from "@gwenjs/physics3d";
import "./layouts/level.ts";
import "./router.ts";

console.log(createEngine, useChildren, Physics3DPlugin, GwenActorError, GwenContextError, GwenWasmAbiError, PoolExhaustedError, defineActor);

try {
  useEngine();
} catch (error) {
  console.log(error instanceof Error ? error.message : "");
}

console.log(new GwenPluginNotFoundError({ pluginName: "demo" }).message);
console.log(new GwenPluginDependencyError({ code: "CORE:PLUGIN_DEPENDENCY_MISSING", plugin: "demo", missing: [{ kind: "plugin", name: "other" }] }).message);

export function devHints(): string | undefined {
  return __GWEN_DEV__ ? ${JSON.stringify(hintText)} : undefined;
}

console.log(devHints());
`,
  );
  writeFileSync(
    join(dir, "src", "layouts", "level.ts"),
    `export const Level1 = defineLayout(() => {});\n`,
  );
  writeFileSync(
    join(dir, "src", "router.ts"),
    `export const AppRouter = defineSceneRouter({ initial: "menu" });\n`,
  );
}

/**
 * Copy each published package into the fixture's node_modules.
 * Real directories, not symlinks: Vite would realpath a symlink back to packages/<name>/dist.
 */
function installGwenDist(dir: string): void {
  const packagesDir = join(repoRoot, "packages");
  for (const entry of readdirSync(packagesDir)) {
    const pkgDir = join(packagesDir, entry);
    const manifestPath = join(pkgDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const pkg = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: string;
      private?: boolean;
      type?: string;
      exports?: unknown;
      main?: string;
      types?: string;
      publishConfig?: { exports?: unknown; main?: string; types?: string };
    };
    if (!pkg.name?.startsWith("@gwenjs/")) continue;
    if (pkg.private === true) continue;
    const distDir = join(pkgDir, "dist");
    if (!existsSync(distDir)) {
      throw new Error(`missing dist for ${pkg.name}. Run pnpm build:ts.`);
    }
    const dest = join(dir, "node_modules", ...pkg.name.split("/"));
    mkdirSync(dest, { recursive: true });
    cpSync(distDir, join(dest, "dist"), { recursive: true });
    const wasmDir = join(pkgDir, "wasm");
    if (existsSync(wasmDir)) cpSync(wasmDir, join(dest, "wasm"), { recursive: true });
    const published: Record<string, unknown> = {
      name: pkg.name,
      type: pkg.type ?? "module",
    };
    const exportsMap = pkg.publishConfig?.exports ?? pkg.exports;
    const main = pkg.publishConfig?.main ?? pkg.main;
    const types = pkg.publishConfig?.types ?? pkg.types;
    if (exportsMap) published["exports"] = exportsMap;
    if (main) published["main"] = main;
    if (types) published["types"] = types;
    writeFileSync(join(dest, "package.json"), JSON.stringify(published));
    linkPackageDeps(pkgDir, dest);
  }
}

/** Package deps stay linked. `@gwenjs/*` resolves to the copied dist, not the workspace. */
function linkPackageDeps(pkgDir: string, dest: string): void {
  const pkgNm = join(pkgDir, "node_modules");
  if (!existsSync(pkgNm)) return;
  const destNm = join(dest, "node_modules");
  mkdirSync(destNm, { recursive: true });
  for (const dep of readdirSync(pkgNm)) {
    if (dep === ".bin" || dep === "@gwenjs") continue;
    const from = join(pkgNm, dep);
    const to = join(destNm, dep);
    if (dep.startsWith("@")) {
      mkdirSync(to, { recursive: true });
      for (const name of readdirSync(from)) {
        const target = join(to, name);
        if (!existsSync(target)) symlinkSync(join(from, name), target);
      }
      continue;
    }
    if (!existsSync(to)) symlinkSync(from, to);
  }
}

function readCoreDist(): string {
  return readJsFiles(join(repoRoot, "packages/core/dist"));
}

function readJs(dir: string): string {
  return readJsFiles(join(dir, "dist"));
}

function readJsFiles(root: string): string {
  const parts: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".js")) parts.push(readFileSync(full, "utf8"));
    }
  };
  walk(root);
  return parts.join("\n");
}

function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const base = createLogger("info", { allowClearScreen: false });
  const logger: Logger = {
    ...base,
    info(msg, options) {
      lines.push(String(msg));
      base.info(msg, options);
    },
    warn(msg, options) {
      lines.push(String(msg));
      base.warn(msg, options);
    },
    error(msg, options) {
      lines.push(String(msg));
      base.error(msg, options);
    },
  };
  return { logger, lines };
}

describe("dev strip", () => {
  it.runIf(__GWEN_DEV__)(
    "strips dev sentinels in prod and keeps them in dev, for src and dist",
    async () => {
      const previous = process.env.NODE_ENV;
      try {
        for (const source of ["src", "dist"] as const) {
          for (const prod of [true, false]) {
            process.env.NODE_ENV = prod ? "production" : "development";
            // macOS tmpdir is /var → /private/var. Vite ids use the real path.
            const dir = mkdtempSync(join(realpathSync(tmpdir()), "gwen-dev-strip-"));
            dirs.push(dir);
            writeFixture(dir);
            const { logger, lines } = captureLogger();
            await build({
              configFile: false,
              root: dir,
              mode: prod ? "production" : "development",
              customLogger: logger,
              plugins: [stripTypesForParser(), gwenAlias(source), gwenVitePlugin({ layout: {} })],
              build: {
                outDir: "dist",
                emptyOutDir: true,
                minify: false,
                write: true,
                rollupOptions: {
                  input: join(dir, "src", "main.ts"),
                  output: { entryFileNames: "main.js", format: "es" },
                },
              },
            });
            const output = readJs(dir);
            const report = lines.find((line) => line.includes("[gwen:dev-strip]"));
            if (prod) {
              for (const sentinel of SENTINELS) {
                expect(output, `${source} prod still has ${sentinel}`).not.toContain(sentinel);
              }
              expect(output).not.toContain("GWEN_DEV_GUARD");
              expect(report, `${source} prod report`).toBeTruthy();
              const match = report?.match(
                /removed (\d+) dev-only sites \((\d+) B source\), (\d+) per-frame instrumentation sites/,
              );
              expect(match, report).toBeTruthy();
              expect(Number(match?.[1])).toBeGreaterThan(0);
              expect(Number(match?.[3])).toBeGreaterThanOrEqual(3);
            } else {
              for (const sentinel of SENTINELS) {
                expect(output, `${source} dev missing ${sentinel}`).toContain(sentinel);
              }
              expect(report, `${source} dev should not report`).toBeUndefined();
            }
          }
        }
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
    },
    240_000,
  );

  it.runIf(__GWEN_DEV__)("unbundled core dist follows the Node default", () => {
    const dist = join(repoRoot, "packages/core/dist/index.js");
    const script = `
      import { createEngine } from ${JSON.stringify(dist)};
      const engine = await createEngine({ debug: true });
      await engine.startExternal();
      await engine.advance(1 / 60);
      const stats = engine.getStats();
      const keys = stats.phaseMs ? Object.keys(stats.phaseMs).sort() : [];
      console.log(JSON.stringify({ phase: Object.prototype.hasOwnProperty.call(stats, "phaseMs"), over: Object.prototype.hasOwnProperty.call(stats, "overBudget"), keys }));
      await engine.stop();
    `;
    const run = (nodeEnv: string | undefined) => {
      const env = { ...process.env };
      if (nodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = nodeEnv;
      return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        env,
        encoding: "utf8",
        cwd: repoRoot,
      });
    };
    const dev = run(undefined);
    expect(dev.status, dev.stderr).toBe(0);
    const devLine = dev.stdout.trim().split("\n").at(-1) ?? "";
    const devStats = JSON.parse(devLine) as { phase: boolean; over: boolean; keys: string[] };
    expect(devStats.phase).toBe(true);
    expect(devStats.over).toBe(true);
    expect(devStats.keys).toEqual([
      "afterTick",
      "plugins",
      "render",
      "tick",
      "total",
      "update",
      "wasm",
    ]);
    const prod = run("production");
    expect(prod.status, prod.stderr).toBe(0);
    const prodLine = prod.stdout.trim().split("\n").at(-1) ?? "";
    const prodStats = JSON.parse(prodLine) as { phase: boolean; over: boolean };
    expect(prodStats.phase).toBe(false);
    expect(prodStats.over).toBe(false);

    // The lib build splits the engine into a chunk. The guard lives there, not in the entry.
    const distSource = readCoreDist();
    expect(distSource).toContain("typeof __GWEN_DEV__");
    expect(distSource).toContain('globalThis.process?.env?.NODE_ENV !== "production"');

    // Import evaluation is hoisted. The flag is read inside functions, so set it after the import.
    const forced = `
      import { createEngine } from ${JSON.stringify(dist)};
      globalThis.__GWEN_DEV__ = false;
      const engine = await createEngine({ debug: true });
      await engine.startExternal();
      await engine.advance(1 / 60);
      const stats = engine.getStats();
      console.log(JSON.stringify({ phase: Object.prototype.hasOwnProperty.call(stats, "phaseMs"), over: Object.prototype.hasOwnProperty.call(stats, "overBudget") }));
      await engine.stop();
    `;
    const env = { ...process.env };
    delete env.NODE_ENV;
    const probed = spawnSync(process.execPath, ["--input-type=module", "-e", forced], {
      env,
      encoding: "utf8",
      cwd: repoRoot,
    });
    expect(probed.status, probed.stderr).toBe(0);
    const probedLine = probed.stdout.trim().split("\n").at(-1) ?? "";
    const probedStats = JSON.parse(probedLine) as { phase: boolean; over: boolean };
    expect(probedStats.phase).toBe(false);
    expect(probedStats.over).toBe(false);
  });

  it.runIf(__GWEN_DEV__)(
    "strips @gwenjs packages that resolve through node_modules",
    async () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const dir = mkdtempSync(join(repoRoot, ".tmp-dev-strip-"));
        dirs.push(dir);
        writeFixture(dir);
        installGwenDist(dir);
        const { logger, lines } = captureLogger();
        await build({
          configFile: false,
          root: dir,
          mode: "production",
          customLogger: logger,
          plugins: [gwenVitePlugin({ layout: {} })],
          build: {
            outDir: "dist",
            emptyOutDir: true,
            minify: false,
            write: true,
            rollupOptions: {
              input: join(dir, "src", "main.ts"),
              output: { entryFileNames: "main.js", format: "es" },
            },
          },
        });
        const output = readJs(dir);
        for (const sentinel of SENTINELS) {
          expect(output, `node_modules prod still has ${sentinel}`).not.toContain(sentinel);
        }
        const report = lines.find((line) => line.includes("[gwen:dev-strip]"));
        expect(report, "node_modules prod report").toBeTruthy();
        const match = report?.match(
          /removed (\d+) dev-only sites \((\d+) B source\), (\d+) per-frame instrumentation sites/,
        );
        expect(match, report).toBeTruthy();
        expect(Number(match?.[1])).toBeGreaterThan(0);
        expect(Number(match?.[3])).toBeGreaterThanOrEqual(3);
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
    },
    120_000,
  );
});
