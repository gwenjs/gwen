/**
 * `vite dev` and `vite build` hand the next plugin the same code and the same skip lines, through
 * `gwen()` and through `gwenVitePlugin()`. A tap plugin right after `gwen:transform-pipeline`
 * keeps the pipeline output of each module: the bundle is not comparable byte for byte after
 * `build()` (precedent: `tests/transform-pipeline/parity.test.ts`).
 * The modules are the 12 positive fixtures of `tests/fixtures/hoist-chunk-columns/`, which are
 * hoisted and log nothing, and `pipeline-app/src/systems/skipped.ts`, which logs one P5 line.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  build,
  createServer,
  type Logger,
  type Plugin,
  type PluginOption,
  type ViteDevServer,
} from "vite";
import { expect, it } from "vitest";
import { gwen } from "../../src/index.js";
import { gwenVitePlugin } from "../../src/plugins/index.js";
import { readAutoImports } from "../transform-pipeline/helpers.js";

const appRoot = fileURLToPath(new URL("../fixtures/pipeline-app/", import.meta.url));
const positivesRoot = fileURLToPath(new URL("../fixtures/hoist-chunk-columns/", import.meta.url));
const SKIPPED = join(appRoot, "src", "systems", "skipped.ts");
const SKIP_LINE = "[gwen:hot-path] skip src/systems/skipped.ts:8 — P5";
const COMPONENTS = "\0test:components";

/** What one run kept: the code every module gave the next plugin, and the logger `info` lines. */
interface Capture {
  readonly code: Map<string, string>;
  readonly info: string[];
}

function positives(): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(positivesRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(join(positivesRoot, entry.name, "input.ts"));
  }
  return found.sort((left, right) => left.localeCompare(right));
}

function recordingLogger(info: string[]): Logger {
  return {
    hasWarned: false,
    info(message) {
      info.push(message);
    },
    warn() {},
    warnOnce() {},
    error() {},
    clearScreen() {},
    hasErrorLogged: () => false,
  };
}

/** The fixtures import `./components`, which no fixture directory holds. */
const componentsStub: Plugin = {
  name: "test:components-stub",
  enforce: "pre",
  resolveId(source, importer) {
    if (source !== "./components" || importer === undefined) return null;
    return importer.startsWith(positivesRoot) ? COMPONENTS : null;
  },
  load(id) {
    if (id !== COMPONENTS) return null;
    return "export const Position = {};\nexport const Velocity = {};\nexport const Angle = {};\n";
  },
};

/** `option` with `tap` right after `gwen:transform-pipeline`, wherever that plugin is nested. */
function withTap(option: PluginOption, tap: Plugin): PluginOption[] {
  if (option === null || option === undefined || option === false || option instanceof Promise) {
    return [option];
  }
  if (Array.isArray(option)) return option.flatMap((item) => withTap(item, tap));
  return option.name === "gwen:transform-pipeline" ? [option, tap] : [option];
}

function stack(option: PluginOption, capture: Capture): PluginOption[] {
  const tap: Plugin = {
    name: "test:tap-pipeline-output",
    enforce: "pre",
    transform(code, id) {
      capture.code.set(id.replaceAll("\\", "/"), code);
      return null;
    },
  };
  return [componentsStub, ...withTap(option, tap)];
}

async function serve(factory: () => PluginOption, ids: readonly string[]): Promise<Capture> {
  const capture: Capture = { code: new Map(), info: [] };
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      configFile: false,
      root: appRoot,
      appType: "custom",
      customLogger: recordingLogger(capture.info),
      plugins: stack(factory(), capture),
      optimizeDeps: { holdUntilCrawlEnd: false },
      server: {
        middlewareMode: true,
        hmr: false,
        preTransformRequests: false,
        fs: { strict: false },
      },
    });
    for (const id of ids) await server.transformRequest(id);
  } finally {
    await server?.close();
  }
  return capture;
}

async function bundle(factory: () => PluginOption, ids: readonly string[]): Promise<Capture> {
  const capture: Capture = { code: new Map(), info: [] };
  await build({
    configFile: false,
    root: appRoot,
    customLogger: recordingLogger(capture.info),
    plugins: stack(factory(), capture),
    build: { write: false, minify: false, rollupOptions: { input: [...ids] } },
  });
  return capture;
}

/** The skip lines among everything Vite logs through `info`. */
function skipLines(capture: Capture): string[] {
  return capture.info.filter((line) => line.startsWith("[gwen:hot-path]"));
}

async function agree(factory: () => PluginOption): Promise<void> {
  const hoisted = positives();
  const ids = [...hoisted, SKIPPED];
  const served = await serve(factory, ids);
  const built = await bundle(factory, ids);
  for (const id of ids) {
    expect(served.code.get(id), id).toBeDefined();
    expect(built.code.get(id), id).toBe(served.code.get(id));
  }
  for (const id of hoisted) expect(served.code.get(id), id).toContain("_gwen_c0");
  expect(skipLines(served)).toEqual([SKIP_LINE]);
  expect(skipLines(built)).toEqual([SKIP_LINE]);
}

it("gwen() serve and build agree on the hoisted code and on the skip lines", async () => {
  await agree(() => gwen({ optimizer: { debug: true } }));
}, 60_000);

it("gwenVitePlugin() serve and build agree on the hoisted code and on the skip lines", async () => {
  const autoImports = [...readAutoImports(join(positivesRoot, "auto-import-free"))];
  await agree(() => gwenVitePlugin({ optimizer: { debug: true }, autoImports }));
}, 60_000);
