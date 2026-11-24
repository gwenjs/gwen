import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { gwenVitePlugin } from "../src/plugins/index.js";
import type { GwenViteOptions } from "../src/types.js";

const ENV_PROBE = `import * as env from "virtual:gwen/env";
export const names = Object.keys(env).sort();
`;

const WASM_PROBE = `import "virtual:gwen/wasm";
`;

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function rootWith(fileName: string, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gwen-wasm-removed-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", fileName), source);
  return dir;
}

function exportNames(loaded: unknown): string[] {
  if (typeof loaded !== "object" || loaded === null) {
    throw new Error("probe module is not an object");
  }
  if ("names" in loaded === false) {
    throw new Error("probe module has no names export");
  }
  const value = loaded.names;
  if (Array.isArray(value) === false) {
    throw new Error("probe names is not an array");
  }
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error("probe name is not a string");
    names.push(item);
  }
  return names;
}

function portOf(server: ViteDevServer): number {
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("dev server has no TCP port");
  }
  return address.port;
}

describe("gwenVitePlugin — removed wasm plugin", () => {
  it("resolves no virtual:gwen/wasm module and has no wasm option", async () => {
    const hasNoWasmOption: "wasm" extends keyof GwenViteOptions ? false : true = true;
    expect(hasNoWasmOption).toBe(true);

    const root = rootWith("probe.ts", "export {};\n");
    const server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      appType: "custom",
      plugins: [gwenVitePlugin()],
      server: { middlewareMode: true, hmr: false },
    });
    try {
      const resolved = await server.pluginContainer.resolveId("virtual:gwen/wasm");
      expect(resolved?.id).not.toBe("\0virtual:gwen/wasm");
    } finally {
      await server.close();
    }
  });

  it("does not answer /@gwen-wasm/debug.wasm", async () => {
    const root = rootWith("probe.ts", "export {};\n");
    const server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      appType: "custom",
      plugins: [gwenVitePlugin()],
      server: { host: "127.0.0.1", port: 0 },
    });
    try {
      await server.listen();
      const response = await fetch(`http://127.0.0.1:${portOf(server)}/@gwen-wasm/debug.wasm`);
      const body = await response.text();
      expect(body).not.toContain("WASM not found");
      expect(response.headers.get("content-type")).not.toBe("application/wasm");
    } finally {
      await server.close();
    }
  });

  it("virtual:gwen/env exports GWEN_VERSION and GWEN_DEV and no GWEN_WASM_VARIANT", async () => {
    const root = rootWith("probe.ts", ENV_PROBE);
    const server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      appType: "custom",
      plugins: [gwenVitePlugin()],
      server: { middlewareMode: true, hmr: false },
    });
    try {
      const loaded = await server.ssrLoadModule("/src/probe.ts");
      expect(exportNames(loaded)).toEqual(["GWEN_DEV", "GWEN_VERSION"]);
    } finally {
      await server.close();
    }
  });

  it("a production build that imports virtual:gwen/wasm does not fail with the WASM binary error", async () => {
    const root = rootWith("probe-wasm.ts", WASM_PROBE);
    let message = "";
    try {
      await build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [gwenVitePlugin()],
        build: {
          write: false,
          rollupOptions: { input: "src/probe-wasm.ts" },
        },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).not.toContain("WASM binary not found");
    expect(message).toContain("virtual:gwen/wasm");
  });
});
