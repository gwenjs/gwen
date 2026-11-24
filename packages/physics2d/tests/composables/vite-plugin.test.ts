/**
 * @file vite-plugin extractLayerDefinitions / inlineLayerReferences unit tests.
 */
import { createServer, resolveConfig, type Plugin, type ViteDevServer } from "vite";
import { describe, it, expect, vi } from "vitest";
import { gwen } from "@gwenjs/vite";
import { extractLayerDefinitions, inlineLayerReferences } from "../../src/vite-plugin.js";
import { physics2dVitePlugin } from "../../src/vite-plugin.js";

describe("extractLayerDefinitions", () => {
  it("extracts simple bitmask values from bit-shift expressions", () => {
    const code = `const Layers = defineLayers({ player: 1 << 0, enemy: 1 << 1, wall: 1 << 2 })`;
    const map = extractLayerDefinitions(code);
    expect(map).not.toBeNull();
    expect(map!.get("player")).toBe(1);
    expect(map!.get("enemy")).toBe(2);
    expect(map!.get("wall")).toBe(4);
  });

  it("extracts literal numeric values", () => {
    const code = `const L = defineLayers({ a: 1, b: 2, c: 4 })`;
    const map = extractLayerDefinitions(code);
    expect(map!.get("a")).toBe(1);
    expect(map!.get("b")).toBe(2);
    expect(map!.get("c")).toBe(4);
  });

  it("returns null when defineLayers is not present", () => {
    expect(extractLayerDefinitions("const x = 1;")).toBeNull();
  });

  it("returns null for an empty defineLayers call", () => {
    const code = `const L = defineLayers({})`;
    expect(extractLayerDefinitions(code)).toBeNull();
  });

  it("handles whitespace around the call", () => {
    const code = `const L = defineLayers( { a: 1 } )`;
    const map = extractLayerDefinitions(code);
    expect(map).not.toBeNull();
    expect(map!.get("a")).toBe(1);
  });

  it("returns a Map with correct size", () => {
    const code = `const L = defineLayers({ x: 1, y: 2 })`;
    const map = extractLayerDefinitions(code);
    expect(map!.size).toBe(2);
  });
});

describe("inlineLayerReferences", () => {
  it("replaces a single layer reference with its literal value", () => {
    const map = new Map([
      ["wall", 4],
      ["player", 1],
    ]);
    const code = `useStaticBody({ layer: Layers.wall, mask: Layers.player })`;
    expect(inlineLayerReferences(code, "Layers", map)).toBe(`useStaticBody({ layer: 4, mask: 1 })`);
  });

  it("replaces multiple occurrences of the same layer", () => {
    const map = new Map([["enemy", 2]]);
    const code = `x = Layers.enemy; y = Layers.enemy;`;
    expect(inlineLayerReferences(code, "Layers", map)).toBe(`x = 2; y = 2;`);
  });

  it("does not modify code when there are no matches", () => {
    const map = new Map([["wall", 4]]);
    const code = `const x = 1;`;
    expect(inlineLayerReferences(code, "Layers", map)).toBe(code);
  });

  it("only replaces the exact variable name (not similar prefixes)", () => {
    const map = new Map([["wall", 4]]);
    const code = `MyLayers.wall + Layers.wall`;
    const result = inlineLayerReferences(code, "Layers", map);
    // Only Layers.wall should be replaced
    expect(result).toBe(`MyLayers.wall + 4`);
  });

  it("replaces across all entries in the map", () => {
    const map = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 4],
    ]);
    const code = `L.a | L.b | L.c`;
    expect(inlineLayerReferences(code, "L", map)).toBe(`1 | 2 | 4`);
  });
});

describe("physics2dVitePlugin transform", () => {
  function callTransform(code: string, id = "src/game.ts") {
    const plugin = physics2dVitePlugin();
    const transform = plugin.transform as (
      code: string,
      id: string,
    ) => { code: string; map: unknown } | null | undefined;
    return transform.call({}, code, id);
  }

  it("returns a non-null source map when layers are inlined", () => {
    const code = [
      "const Layers = defineLayers({ wall: 1 << 2, player: 1 << 0 });",
      "useStaticBody({ layer: Layers.wall, mask: Layers.player });",
    ].join("\n");

    const result = callTransform(code);

    expect(result).toBeDefined();
    expect(result!.map).not.toBeNull();
    expect(result!.map).toHaveProperty("mappings");
  });

  it("removes the defineLayers declaration when all references are inlined", () => {
    const code = [
      "const Layers = defineLayers({ wall: 4, player: 1 });",
      "useStaticBody({ layer: Layers.wall, mask: Layers.player });",
    ].join("\n");

    const result = callTransform(code);

    expect(result).toBeDefined();
    expect(result!.code).not.toContain("defineLayers");
    expect(result!.code).not.toContain("const Layers");
    expect(result!.code).toContain("4");
    expect(result!.code).toContain("1");
  });

  it("keeps the defineLayers declaration when the variable is still referenced", () => {
    const code = [
      "const Layers = defineLayers({ wall: 4 });",
      "useStaticBody({ layer: Layers.wall });",
      "console.log(Layers);",
    ].join("\n");

    const result = callTransform(code);

    expect(result).toBeDefined();
    expect(result!.code).toContain("defineLayers");
  });

  it("warns when a layer is defined but never referenced", async () => {
    const plugin = physics2dVitePlugin();
    const warnings: string[] = [];
    const mockCtx = { warn: vi.fn((m: string) => warnings.push(m)) };

    const code = `
      const L = defineLayers({ wall: 1, player: 2 })
      useStaticBody({ layer: L.wall }) // player never used
    `;
    await (plugin.transform as Function).call(mockCtx, code, "test.ts");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("player");
  });
});

const MODULE_ID = "/src/layers.ts";
const SPECIFIER = "@gwenjs/physics2d";

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
    "useStaticBody({ layer: Layers.wall });",
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
  for (let index = 0; index < copies; index += 1) physics.push(physics2dVitePlugin());
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

describe("physics2dVitePlugin on the transform pipeline", () => {
  it("registers gwen:layer-inline on the pipeline api", async () => {
    await withServer(stringSource(), 1, async (server, pipeline) => {
      await server.transformRequest(MODULE_ID);
      expect(layerNames(pipeline)).toEqual(["gwen:layer-inline"]);
    });
  });

  it("throws the pipeline-absent error without gwen:transform-pipeline", async () => {
    await expect(
      resolveConfig(
        { configFile: false, logLevel: "silent", plugins: [physics2dVitePlugin()] },
        "serve",
      ),
    ).rejects.toMatchObject({ code: "PHYSICS2D:VITE_PIPELINE_" + "MISSING" });
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
