import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createLogger, type Logger, type Plugin } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { gwenVitePlugin } from "../src/plugins/index.js";

declare const __GWEN_DEV__: boolean;

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * #64 classes are not in this tree. These strings stand in for one inline hint
 * per class named by that spec, so the strip can be proved without landing #64.
 */
const HINT_CLASSES = [
  "GwenContextError",
  "GwenActorError",
  "PoolExhaustedError",
  "GwenEngineStateError",
  "GwenPluginNotFoundError",
  "GwenWasmError",
  "GwenConfigError",
  "GwenModuleDefinitionError",
  "GwenConfigLoadError",
  "GwenPluginDependencyError",
  "GwenPluginShapeError",
  "GwenWasmAbiError",
];

/** Unique phrases. Bare class names already exist on prod error classes. */
const HINT_TEXTS = HINT_CLASSES.map((name) => `dev-only hint for ${name}`);

const SENTINELS = [
  ...HINT_TEXTS,
  "not available in local mode",
  "WASM core loaded",
  "exceeded 50% of frame budget",
  "WASM memory sentinel violation",
  "ownership transferred",
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

function gwenAlias(mode: "src" | "dist"): Plugin {
  return {
    name: "gwen-src-or-dist",
    enforce: "pre",
    resolveId(id) {
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
      return join(pkgDir, target);
    },
  };
}

function writeFixture(dir: string): void {
  mkdirSync(join(dir, "src", "layouts"), { recursive: true });
  const hintText = `${HINT_TEXTS.join(" ")} __GWEN_DEV__ import.meta.env`;
  writeFileSync(
    join(dir, "src", "main.ts"),
    `import { createEngine } from "@gwenjs/core";
import { useChildren } from "@gwenjs/core/actor";
import { Physics3DPlugin } from "@gwenjs/physics3d";
import "./layouts/level.ts";
import "./router.ts";

console.log(createEngine, useChildren, Physics3DPlugin);

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

function readJs(dir: string): string {
  const parts: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".js")) parts.push(readFileSync(full, "utf8"));
    }
  };
  walk(join(dir, "dist"));
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
            const dir = mkdtempSync(join(tmpdir(), "gwen-dev-strip-"));
            dirs.push(dir);
            writeFixture(dir);
            const { logger, lines } = captureLogger();
            await build({
              configFile: false,
              root: dir,
              mode: prod ? "production" : "development",
              customLogger: logger,
              plugins: [gwenAlias(source), gwenVitePlugin({ layout: {} })],
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
      "physics",
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
  });
});
