/**
 * The pipeline is wired once into each plugin factory, and serve matches build.
 * `configFile: false` keeps Vite off `packages/vite/vite.config.ts`
 * (`packages/vite/tests/dev-flag.test.ts:64`).
 */

import { fileURLToPath } from "node:url";
import { build, createServer, type Plugin, type PluginOption, type ViteDevServer } from "vite";
import { describe, expect, it } from "vitest";
import { gwen } from "../../src/index.js";
import { gwenVitePlugin } from "../../src/plugins/index.js";
import type { GwenTransformPipelineApi } from "../../src/pipeline/transform-pipeline.js";
import { testInsert } from "./helpers.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures/pipeline-app/", import.meta.url));

function countPipeline(option: PluginOption): number {
  if (option === null || option === undefined || option === false) return 0;
  if (option instanceof Promise) return 0;
  if (Array.isArray(option)) {
    let total = 0;
    for (const item of option) total += countPipeline(item);
    return total;
  }
  return option.name === "gwen:transform-pipeline" ? 1 : 0;
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

function stack(capture: { code: string | undefined }): PluginOption[] {
  const owned = gwen();
  const pipeline = findPipeline(owned);
  const registrar: Plugin = {
    name: "test:register-insert",
    enforce: "pre",
    configResolved() {
      if (pipeline === undefined) return;
      pipeline.api.register(testInsert);
    },
  };
  const tap: Plugin = {
    name: "test:tap-pipeline-output",
    enforce: "pre",
    transform(code, id) {
      if (id.replaceAll("\\", "/").includes("/src/systems/score.ts")) capture.code = code;
      return null;
    },
  };
  return [registrar, ...owned, tap];
}

describe("gwen:transform-pipeline parity", () => {
  it("gwen() and gwenVitePlugin() each contain gwen:transform-pipeline exactly once", () => {
    expect([countPipeline(gwen()), countPipeline(gwenVitePlugin())]).toEqual([1, 1]);
  });

  it("serve and build emit byte-identical transformed code for the fixture module", async () => {
    const lookedUp = findPipeline(gwen());
    expect(lookedUp?.name).toBe("gwen:transform-pipeline");
    if (lookedUp === undefined) return;

    const serveCapture: { code: string | undefined } = { code: undefined };
    const buildCapture: { code: string | undefined } = { code: undefined };
    let server: ViteDevServer | undefined;
    try {
      server = await createServer({
        configFile: false,
        root: fixtureRoot,
        plugins: stack(serveCapture),
        server: { middlewareMode: true, hmr: false },
        logLevel: "silent",
      });
      await server.transformRequest("/src/systems/score.ts");
      await build({
        configFile: false,
        root: fixtureRoot,
        plugins: stack(buildCapture),
        build: { write: false, minify: false },
        logLevel: "silent",
      });
    } finally {
      await server?.close();
    }

    expect(serveCapture.code).toEqual(expect.stringContaining("/*X*/"));
    expect(buildCapture.code).toEqual(expect.stringContaining("/*X*/"));
    expect(serveCapture.code).toBe(buildCapture.code);
  });
});
