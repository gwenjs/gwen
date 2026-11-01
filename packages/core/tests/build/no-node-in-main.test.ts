/**
 * The built main entry must not contain a `node:` specifier.
 * The test also asserts the node entry control: that graph still imports `node:fs`.
 * The test builds `packages/core/vite.config.ts` into a temp directory.
 * `vite:dts` is dropped: its `outDir` is `dist`, which is the real package output.
 */

import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build, type Plugin, type PluginOption } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

const CORE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CONFIG_FILE = join(CORE_ROOT, "vite.config.ts");
const NODE_SPECIFIER = /["'`]node:[\w/]+["'`]/;
const NODE_FS = /["']node:fs["']/;

let outDir = "";

function isViteDts(entry: object): entry is Plugin {
  return "name" in entry && entry.name === "vite:dts";
}

/** `vite:dts` emits `.d.ts` into `outDir: "dist"` (`packages/core/vite.config.ts`). */
function stripDtsEmit(entry: PluginOption): void {
  if (typeof entry !== "object" || entry === null) return;
  if (Array.isArray(entry)) {
    for (const nested of entry) stripDtsEmit(nested);
    return;
  }
  if (!isViteDts(entry)) return;
  delete entry.buildStart;
  delete entry.generateBundle;
  delete entry.writeBundle;
  delete entry.closeBundle;
}

function dropViteDts(): Plugin {
  return {
    name: "drop-vite-dts",
    // User plugins are already resolved when `config` runs, so the hook edits the
    // plugin object. `configResolved` repeats it on the list the build will call.
    enforce: "pre",
    config(config) {
      const plugins = config.plugins;
      if (plugins === undefined) return;
      for (const entry of plugins) stripDtsEmit(entry);
    },
    configResolved(config) {
      for (const plugin of config.plugins) {
        if (plugin.name !== "vite:dts") continue;
        delete plugin.buildStart;
        delete plugin.generateBundle;
        delete plugin.writeBundle;
        delete plugin.closeBundle;
      }
    },
  };
}

function collectChunks(entry: string): Array<{ file: string; text: string }> {
  const chunks: Array<{ file: string; text: string }> = [];
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    chunks.push({ file, text });
    const dir = dirname(file);
    const relativeSpecifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.[^"']+)["']/g;
    for (const match of text.matchAll(relativeSpecifier)) {
      const spec = match[1];
      if (spec === undefined) continue;
      queue.push(resolve(dir, spec));
    }
  }
  return chunks;
}

beforeAll(async () => {
  outDir = mkdtempSync(join(realpathSync(tmpdir()), "gwen-no-node-main-"));
  await build({
    configFile: CONFIG_FILE,
    root: CORE_ROOT,
    logLevel: "silent",
    plugins: [dropViteDts()],
    build: {
      outDir,
      emptyOutDir: true,
    },
  });
}, 120_000);

afterAll(() => {
  if (outDir !== "") rmSync(outDir, { recursive: true, force: true });
});

it("the built main entry graph has no node: specifier", () => {
  const nodeChunks = collectChunks(join(outDir, "node.js"));
  expect(
    nodeChunks.some((chunk) => NODE_FS.test(chunk.text)),
    "the node entry graph must still import node:fs (control)",
  ).toBe(true);
  const chunks = collectChunks(join(outDir, "index.js"));
  const hits = chunks.filter((chunk) => NODE_SPECIFIER.test(chunk.text));
  expect(hits.map((chunk) => chunk.file)).toEqual([]);
}, 120_000);
