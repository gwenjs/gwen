/**
 * The pipeline is wired once into each plugin factory, and serve matches build.
 * `configFile: false` keeps Vite off `packages/vite/vite.config.ts`
 * (`packages/vite/tests/dev-flag.test.ts:64`).
 */

import { fileURLToPath } from "node:url";
import { build, createServer, type Plugin, type PluginOption, type ViteDevServer } from "vite";
import { describe, expect, it } from "vitest";
import { ViteErrorCodes } from "../../src/error-codes.js";
import { gwen } from "../../src/index.js";
import { gwenVitePlugin } from "../../src/plugins/index.js";
import type { GwenSourceTransform } from "../../src/pipeline/types.js";
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
  const plugins: PluginOption[] = [registrar];
  for (const plugin of owned) {
    plugins.push(plugin);
    if (plugin.name === "gwen:transform-pipeline") plugins.push(tap);
  }
  return plugins;
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

  it("a syntax error reaches a real Vite server with loc, frame, plugin and cause code", async () => {
    const id = "/src/broken.ts";
    const server = await createServer({
      configFile: false,
      root: fixtureRoot,
      plugins: [virtualSource(id, "const a = 1;\nconst b = 2;\nconst =\n"), gwen()],
      server: { middlewareMode: true, hmr: false },
      logLevel: "silent",
    });
    try {
      await expect(server.transformRequest(id)).rejects.toSatisfy((error: unknown) =>
        realHost(error, {
          file: id,
          line: 3,
          column: 6,
          causeCode: "VITE:TRANSFORM_PARSE_FAILED",
        }),
      );
    } finally {
      await server.close();
    }
  });

  it("ctx.raise reaches a real Vite server with loc, frame and cause code", async () => {
    const id = "/src/raised.ts";
    const owned = gwen();
    const pipeline = findPipeline(owned);
    const registrar: Plugin = {
      name: "test:register-raise",
      enforce: "pre",
      configResolved() {
        if (pipeline === undefined) return;
        const raiseUnit: GwenSourceTransform = {
          name: "gwen:raise",
          run(_program, ctx) {
            return ctx.raise(
              ViteErrorCodes.TRANSFORM_UNSUPPORTED,
              { start: 19, end: 20 },
              "what",
              "a hint",
            );
          },
        };
        pipeline.api.register(raiseUnit);
      },
    };
    const server = await createServer({
      configFile: false,
      root: fixtureRoot,
      plugins: [
        virtualSource(id, "const a = 1;\nconst b = 2;\nconst c = 3;\n"),
        registrar,
        ...owned,
      ],
      server: { middlewareMode: true, hmr: false },
      logLevel: "silent",
    });
    try {
      await expect(server.transformRequest(id)).rejects.toSatisfy((error: unknown) =>
        realHost(error, {
          file: id,
          line: 2,
          column: 6,
          causeCode: ViteErrorCodes.TRANSFORM_UNSUPPORTED,
        }),
      );
    } finally {
      await server.close();
    }
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Broken source stays off disk. The id is a real `.ts` path, so the pipeline filter accepts it. */
function virtualSource(id: string, source: string): Plugin {
  return {
    name: "test:virtual-source",
    enforce: "pre",
    resolveId(sourceId) {
      if (sourceId === id) return sourceId;
      return null;
    },
    load(sourceId) {
      if (sourceId === id) return source;
      return null;
    },
  };
}

function realHost(
  error: unknown,
  expected: { file: string; line: number; column: number; causeCode: string },
): boolean {
  if (!isRecord(error)) return false;
  const loc = error["loc"];
  if (!isRecord(loc)) return false;
  const frame = error["frame"];
  const cause = error["cause"];
  if (!isRecord(cause)) return false;
  return (
    loc["file"] === expected.file &&
    loc["line"] === expected.line &&
    loc["column"] === expected.column &&
    typeof frame === "string" &&
    frame.length > 0 &&
    error["plugin"] === "gwen:transform-pipeline" &&
    cause["code"] === expected.causeCode
  );
}
