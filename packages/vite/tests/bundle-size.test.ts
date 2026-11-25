/**
 * A real production `vite build` of one fixture app per engine variant, with the real `gwen()`
 * plugin. Run with `pnpm --filter @gwenjs/vite test:bundle` (vitest.bundle.config.ts): the default
 * config excludes this file. It needs the built `dist` of the `@gwenjs/*` packages and the WASM
 * artifacts (`pnpm build:ts`, `pnpm build:wasm`).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { build, createLogger, type InlineConfig } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { gwen } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const variants = ["light", "physics2d", "physics3d"] as const;
type Variant = (typeof variants)[number];

interface Dist {
  out: string;
  /** Every file of the output directory, relative and posix-separated. */
  files: string[];
  js: string[];
  wasm: string[];
  /** Every `.js` chunk, joined. */
  text: string;
}

interface Budget {
  jsGzipBytes: number;
  wasmGzipBytes: number;
}

const coreWasm = (v: Variant): string =>
  path.join(repoRoot, "packages/core/wasm", v, "gwen_core_bg.wasm");
const bvhWasm = path.join(repoRoot, "packages/physics3d/wasm/bvh/gwen_core_bg.wasm");
const fixtureRoot = (v: Variant): string =>
  path.join(repoRoot, "packages/vite/tests/fixtures", `app-${v}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gwen-bundle-"));

const ssrFixtures = ["app-ssr", "app-ssr-noexternal"] as const;
type SsrFixture = (typeof ssrFixtures)[number];
const ssrFixtureRoot = (name: SsrFixture): string =>
  path.join(repoRoot, "packages/vite/tests/fixtures", name);

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // An SSR output stays inside its fixture, where the external `@gwenjs/core` resolves.
  for (const name of ssrFixtures) {
    fs.rmSync(path.join(ssrFixtureRoot(name), "dist"), { recursive: true, force: true });
  }
});

const sha = (file: string): string =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const gzipBytes = (file: string): number => gzipSync(fs.readFileSync(file), { level: 9 }).length;

function walk(dir: string, base: string = dir): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, base));
    else files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files;
}

const builds = new Map<Variant, Promise<Dist>>();

/** One build per variant: a failed build fails only the tests of that variant. */
function distOf(v: Variant): Promise<Dist> {
  const known = builds.get(v);
  if (known) return known;
  const made = buildVariant(v);
  builds.set(v, made);
  return made;
}

async function buildVariant(v: Variant): Promise<Dist> {
  for (const wasm of [coreWasm(v), bvhWasm]) {
    if (!fs.existsSync(wasm)) throw new Error(`run pnpm build:wasm first: ${wasm} is absent`);
  }
  const out = path.join(tmp, v);
  await build({
    root: fixtureRoot(v),
    configFile: false,
    plugins: gwen(),
    logLevel: "silent",
    mode: "production",
    build: { outDir: out, emptyOutDir: true, minify: true },
  });
  const files = walk(out);
  const js = files.filter((f) => f.endsWith(".js"));
  return {
    out,
    files,
    js,
    wasm: files.filter((f) => f.endsWith(".wasm")),
    text: js.map((f) => fs.readFileSync(path.join(out, f), "utf8")).join("\n"),
  };
}

interface SsrRun {
  /** Every warning the build logged. */
  warnings: string[];
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * The `ssr` option is the only difference between the two SSR fixtures. `@gwenjs/core` is a
 * workspace link outside node_modules here, so Vite bundles it unless the build says otherwise.
 */
const ssrOptions: Record<SsrFixture, NonNullable<InlineConfig["ssr"]>> = {
  "app-ssr": { external: ["@gwenjs/core"] },
  "app-ssr-noexternal": { noExternal: ["@gwenjs/core"] },
};

const ssrRuns = new Map<SsrFixture, Promise<SsrRun>>();

/** One SSR build and one server run per fixture. */
function ssrRunOf(name: SsrFixture): Promise<SsrRun> {
  const known = ssrRuns.get(name);
  if (known) return known;
  const made = buildAndRunServer(name);
  ssrRuns.set(name, made);
  return made;
}

async function buildAndRunServer(name: SsrFixture): Promise<SsrRun> {
  const root = ssrFixtureRoot(name);
  const out = path.join(root, "dist/ssr");
  const warnings: string[] = [];
  const logger = createLogger("warn");
  logger.warn = (message) => {
    warnings.push(message);
  };
  await build({
    root,
    configFile: false,
    plugins: gwen(),
    customLogger: logger,
    mode: "production",
    ssr: ssrOptions[name],
    build: { ssr: "src/server.ts", outDir: out, emptyOutDir: true },
  });
  const run = spawnSync(process.execPath, [path.join(out, "server.js")], {
    encoding: "utf8",
    timeout: 60_000,
  });
  return { warnings, status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** The same function the library gate uses (scripts/check-wasm-size.mjs `allowedBudget`). */
async function loadAllowedBudget(): Promise<(baseline: number) => number> {
  const mod: unknown = await import(
    pathToFileURL(path.join(repoRoot, "scripts/check-wasm-size.mjs")).href
  );
  const allowed = Reflect.get(Object(mod), "allowedBudget");
  if (typeof allowed !== "function") throw new Error("allowedBudget is absent");
  return (baseline: number): number => {
    const value: unknown = allowed(baseline);
    if (typeof value !== "number") throw new Error("allowedBudget returned a non-number");
    return value;
  };
}

/** A failure names the marker: `[marker, found]` against `[marker, expected]`. */
function expectMarkers(text: string, markers: readonly string[], expected: boolean): void {
  for (const marker of markers) {
    expect([marker, text.includes(marker)]).toEqual([marker, expected]);
  }
}

const baseName = (file: string): string => path.posix.basename(file);
const gzipSum = (dist: Dist, files: string[]): number =>
  files.reduce((sum, f) => sum + gzipBytes(path.join(dist.out, f)), 0);

describe("bundle-size", () => {
  it.each(variants)(
    "%s dist holds exactly one core binary, hashed, matching the declared variant by sha256",
    async (v) => {
      const dist = await distOf(v);
      const bvhSha = sha(bvhWasm);
      const core = dist.wasm.filter((f) => sha(path.join(dist.out, f)) !== bvhSha);
      expect(core).toHaveLength(1);
      const [file] = core;
      expect(file).toMatch(/^assets\/gwen_core_bg-[\w-]+\.wasm$/);
      expect(sha(path.join(dist.out, file ?? ""))).toBe(sha(coreWasm(v)));
      const bvh = dist.wasm.filter((f) => sha(path.join(dist.out, f)) === bvhSha);
      expect(bvh).toHaveLength(v === "physics3d" ? 1 : 0);
    },
  );

  it.each(variants)(
    "%s dist has no dist/wasm directory, no data:application/wasm and no virtual:gwen/wasm",
    async (v) => {
      const dist = await distOf(v);
      expect(fs.existsSync(path.join(dist.out, "wasm"))).toBe(false);
      expectMarkers(dist.text, ["data:application/wasm", "virtual:gwen/wasm"], false);
    },
  );

  it.each(variants)("%s dist has no node: specifier", async (v) => {
    const dist = await distOf(v);
    expectMarkers(dist.text, ["node:"], false);
  });

  it.each(variants)("no -dev binary is in the %s prod dist", async (v) => {
    const dist = await distOf(v);
    expectMarkers(dist.text, ["-dev/"], false);
    const checked = variants.map((name) =>
      sha(path.join(repoRoot, "packages/core/wasm", `${name}-dev`, "gwen_core_bg.wasm")),
    );
    for (const file of dist.wasm) {
      expect(checked).not.toContain(sha(path.join(dist.out, file)));
    }
  });

  it("light dist has no physics marker", async () => {
    const dist = await distOf("light");
    expectMarkers(
      dist.text,
      [
        "physics_init",
        "physics3d_init",
        "physics2d_",
        "physics3d_",
        "PHYSICS2D:",
        "PHYSICS3D:",
        "wasmBridge.physics2d",
        "wasmBridge.physics3d",
      ],
      false,
    );
  });

  it("physics2d dist has no 3D marker and no BVH asset", async () => {
    const dist = await distOf("physics2d");
    // Positive control: a renamed 2D marker would silently weaken the absence checks.
    expectMarkers(dist.text, ["PHYSICS2D:", "physics_init", "physics2d_"], true);
    expectMarkers(
      dist.text,
      ["physics3d_init", "physics3d_", "PHYSICS3D:", "wasmBridge.physics3d"],
      false,
    );
    const bvhSha = sha(bvhWasm);
    expect(dist.wasm.filter((f) => sha(path.join(dist.out, f)) === bvhSha)).toEqual([]);
    expect(dist.files.filter((f) => baseName(f).startsWith("bvh"))).toEqual([]);
  });

  it("physics3d dist has no 2D marker", async () => {
    const dist = await distOf("physics3d");
    // Positive control, as for the 2D test.
    expectMarkers(dist.text, ["PHYSICS3D:", "physics3d_init", "wasmBridge.physics3d"], true);
    expectMarkers(
      dist.text,
      ["physics_init", "physics2d_", "PHYSICS2D:", "wasmBridge.physics2d"],
      false,
    );
  });

  it.each(variants)("%s dist references exactly one core binary", async (v) => {
    const dist = await distOf(v);
    // The BVH binary is referenced by its worker chunk only, never by the entry chunks.
    const chunks = dist.js.filter((f) => !baseName(f).startsWith("bvh-worker"));
    const referenced = new Set<string>();
    for (const f of chunks) {
      const code = fs.readFileSync(path.join(dist.out, f), "utf8");
      for (const match of code.matchAll(/gwen_core_bg-[\w-]+\.wasm/g)) referenced.add(match[0]);
    }
    const coreSha = sha(coreWasm(v));
    const shipped = dist.wasm.filter((f) => sha(path.join(dist.out, f)) === coreSha).map(baseName);
    expect([...referenced].sort()).toEqual(shipped.sort());
    expect(shipped).toHaveLength(1);
  });

  it.each(variants)("%s JS and wasm gzip bytes stay within bundle-budget.json", async (v) => {
    const dist = await distOf(v);
    const budgets: Record<Variant, Budget> = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "packages/vite/tests/fixtures/bundle-budget.json"),
        "utf8",
      ),
    );
    const allowedBudget = await loadAllowedBudget();
    // Vitest prints `expected <measured> to be less than or equal to <allowed>`.
    expect(gzipSum(dist, dist.js)).toBeLessThanOrEqual(allowedBudget(budgets[v].jsGzipBytes));
    expect(gzipSum(dist, dist.wasm)).toBeLessThanOrEqual(allowedBudget(budgets[v].wasmGzipBytes));
  });

  it("app-light contains no framework-provider string", async () => {
    // The row of the provider table: its export name is the one string that no other code carries.
    const markers = ["CameraCorePlugin"];
    // Positive control: the built @gwenjs/app carries the table (in `resolve.js` or in a shared
    // chunk). A renamed row would otherwise leave the absence check below with nothing to find.
    const appDist = path.join(repoRoot, "packages/app/dist");
    const appText = fs
      .readdirSync(appDist)
      .filter((f) => f.endsWith(".js"))
      .map((f) => fs.readFileSync(path.join(appDist, f), "utf8"))
      .join("\n");
    expectMarkers(appText, markers, true);
    const dist = await distOf("light");
    expectMarkers(dist.text, markers, false);
  });

  it("physics3d dist holds the BVH worker binary next to the core binary", async () => {
    const dist = await distOf("physics3d");
    const bvhSha = sha(bvhWasm);
    expect(dist.wasm.filter((f) => sha(path.join(dist.out, f)) === bvhSha)).toHaveLength(1);
    expect(dist.files.filter((f) => /^assets\/bvh-worker-[^/]+\.js$/.test(f))).toHaveLength(1);
  });

  it("app-physics2d-uses-3d fails the build with VITE:VARIANT_REQUIRED naming physics3d", async () => {
    const failure = await build({
      root: path.join(repoRoot, "packages/vite/tests/fixtures/app-physics2d-uses-3d"),
      configFile: false,
      plugins: gwen(),
      logLevel: "silent",
      mode: "production",
      build: { outDir: path.join(tmp, "uses-3d"), emptyOutDir: true },
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : "";
    for (const token of [
      "VITE:VARIANT_REQUIRED",
      "src/probe.ts",
      "@gwenjs/physics3d",
      '"physics3d" variant',
    ]) {
      expect([token, message.includes(token)]).toEqual([token, true]);
    }
  });

  it("app-ssr builds with @gwenjs/core external and the server runs", async () => {
    const run = await ssrRunOf("app-ssr");
    expect([run.status, run.stdout]).toEqual([0, "frames:1\n"]);
    expect(run.warnings.filter((warning) => warning.includes("ssr.noExternal"))).toEqual([]);
  });

  it("app-ssr-noexternal warns at config time", async () => {
    const run = await ssrRunOf("app-ssr-noexternal");
    expect(run.warnings.filter((warning) => warning.includes("ssr.noExternal"))).toHaveLength(1);
  });

  it("app-ssr-noexternal bundled server fails with CORE:WASM_LOAD_ERROR", async () => {
    const run = await ssrRunOf("app-ssr-noexternal");
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("CORE:WASM_LOAD_ERROR");
  });
});
