/**
 * @file physics3dVitePlugin registers gwen:layer-inline on the transform pipeline.
 */
import { createServer, resolveConfig, type Plugin, type ViteDevServer } from "vite";
import { describe, it, expect } from "vitest";
import { gwen } from "@gwenjs/vite";
import { physics3dVitePlugin } from "../src/vite-plugin.js";

const MODULE_ID = "/src/layers.ts";
const SPECIFIER = "@gwenjs/physics3d";

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

function layerNames(plugin: Plugin): string[] {
  const api: unknown = plugin.api;
  if (typeof api !== "object" || api === null || !("names" in api)) return [];
  const names: unknown = api.names;
  if (!Array.isArray(names)) return [];
  const found: string[] = [];
  for (const name of names) {
    if (name === "gwen:layer-inline") found.push(name);
  }
  return found;
}

function mappingLength(map: unknown): number {
  if (typeof map !== "object" || map === null || !("mappings" in map)) return 0;
  const mappings: unknown = map.mappings;
  return typeof mappings === "string" ? mappings.length : 0;
}

function stringSource(): string {
  return [
    `import { defineLayers } from "${SPECIFIER}";`,
    "const Layers = defineLayers({ wall: 1 << 2 });",
    'const label = "Layers.wall";',
    "useDynamicBody({ layer: Layers.wall });",
  ].join("\n");
}

function aliasSource(): string {
  return [
    `import { defineLayers as dl } from "${SPECIFIER}";`,
    "const Layers = dl({ wall: (1 << 0) | (1 << 2) });",
    "const label = Layers.wall;",
  ].join("\n");
}

async function withServer(
  source: string,
  copies: number,
  run: (server: ViteDevServer, pipeline: Plugin) => Promise<void>,
): Promise<void> {
  const pipeline = gwen().find((plugin) => plugin.name === "gwen:transform-pipeline");
  expect(pipeline?.name).toBe("gwen:transform-pipeline");
  if (pipeline === undefined) return;
  const physics: Plugin[] = [];
  for (let index = 0; index < copies; index += 1) physics.push(physics3dVitePlugin());
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      configFile: false,
      plugins: [virtualSource(MODULE_ID, source), pipeline, ...physics],
      server: { middlewareMode: true, hmr: false },
      logLevel: "silent",
    });
    await run(server, pipeline);
  } finally {
    await server?.close();
  }
}

describe("physics3dVitePlugin on the transform pipeline", () => {
  it("registers gwen:layer-inline on the pipeline api", async () => {
    await withServer(stringSource(), 1, async (server, pipeline) => {
      await server.transformRequest(MODULE_ID);
      expect(layerNames(pipeline)).toEqual(["gwen:layer-inline"]);
    });
  });

  it("throws the pipeline-absent error without gwen:transform-pipeline", async () => {
    await expect(
      resolveConfig(
        { configFile: false, logLevel: "silent", plugins: [physics3dVitePlugin()] },
        "serve",
      ),
    ).rejects.toMatchObject({ code: "PHYSICS3D:VITE_PIPELINE_" + "MISSING" });
  });

  it("a layer reference inside a string is kept and the map is valid", async () => {
    await withServer(stringSource(), 1, async (server) => {
      const result = await server.transformRequest(MODULE_ID);
      expect(result?.code).toContain('const label = "Layers.wall";');
      expect(mappingLength(result?.map)).toBeGreaterThan(0);
    });
  });

  it("an aliased defineLayers import and a shifted expression are inlined", async () => {
    await withServer(aliasSource(), 1, async (server) => {
      const result = await server.transformRequest(MODULE_ID);
      expect(result?.code).toContain("const label = 5;");
      expect(result?.code).not.toContain("Layers.wall");
    });
  });

  it("registering the plugin twice does not duplicate edits", async () => {
    await withServer(aliasSource(), 2, async (server, pipeline) => {
      const result = await server.transformRequest(MODULE_ID);
      expect(layerNames(pipeline)).toEqual(["gwen:layer-inline"]);
      const code = result?.code ?? "";
      expect(code.split("const label = 5;").length - 1).toBe(1);
    });
  });
});
