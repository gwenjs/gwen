/**
 * A real dev server serves the glue factory as its own module, next to its binary.
 * The specifier is the quoted path on `import * as __gwenGlue from "..."`.
 * `holdUntilCrawlEnd: false` lets `server.close()` return. Discovery stays on:
 * three runs closed with a private cacheDir, so `noDiscovery` is not set.
 * `noDiscovery` would hide `exclude`. The config test in tests/vite-plugin.test.ts proves that list.
 */

import fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { describe, expect, it } from "vitest";
import { gwen } from "../src/index.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/pipeline-app/", import.meta.url));
const glueMarker = 'import * as __gwenGlue from "';

function glueSpecifier(code: string): string {
  const at = code.indexOf(glueMarker);
  if (at < 0) return "";
  const start = at + glueMarker.length;
  const end = code.indexOf('"', start);
  if (end < 0) return "";
  return code.slice(start, end);
}

function filesystemPath(file: string): string {
  const query = file.indexOf("?");
  if (query < 0) return file;
  return file.slice(0, query);
}

describe("dev factory", () => {
  it("the dev server serves the factory unbundled next to its binary", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwen-dev-factory-"));
    let server: ViteDevServer | undefined;
    try {
      server = await createServer({
        configFile: false,
        root: fixtureRoot,
        cacheDir,
        plugins: gwen(),
        optimizeDeps: { holdUntilCrawlEnd: false },
        server: { middlewareMode: true, hmr: false },
        logLevel: "silent",
      });
      const entry = await server.transformRequest("/@gwenjs/gwen-entry");
      const code = entry?.code ?? "";
      const url = glueSpecifier(code);
      expect(url.length).toBeGreaterThan(0);
      expect(url.startsWith("/node_modules/.vite/deps/")).toBe(false);
      // A cache outside the project is served as `/@fs/<cacheDir>/deps/`, not `/node_modules/.vite/deps/`.
      expect(url.startsWith(`/@fs${cacheDir}/deps/`)).toBe(false);
      const mod = await server.moduleGraph.getModuleByUrl(url);
      const file = mod?.file ?? null;
      expect(typeof file).toBe("string");
      if (typeof file !== "string") return;
      const factoryFile = filesystemPath(file);
      expect(path.basename(factoryFile)).toBe("gwen_core_factory.js");
      expect(fs.existsSync(path.join(path.dirname(factoryFile), "gwen_core_bg.wasm"))).toBe(true);
    } finally {
      if (server !== undefined) await server.close();
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
