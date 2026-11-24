/**
 * @file physics2dVitePlugin registers gwen:layer-inline on the transform pipeline.
 */
import { createServer, resolveConfig, type Plugin, type ViteDevServer } from "vite";
import { describe, it, expect } from "vitest";
import { gwen } from "@gwenjs/vite";
import { physics2dVitePlugin } from "../../src/vite-plugin.js";

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

const VLQ_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function readVlq(text: string, at: number): { value: number; next: number } | undefined {
  let shift = 0;
  let result = 0;
  let index = at;
  while (index < text.length) {
    const digit = VLQ_ALPHABET.indexOf(text.charAt(index));
    if (digit < 0) return undefined;
    index += 1;
    result += (digit & 31) << shift;
    if ((digit & 32) === 0) {
      const magnitude = result >> 1;
      const value = (result & 1) === 1 ? -magnitude : magnitude;
      return { value, next: index };
    }
    shift += 5;
  }
  return undefined;
}

function readMappings(map: unknown): string | undefined {
  if (typeof map === "string") {
    const parsed: unknown = JSON.parse(map);
    return readMappings(parsed);
  }
  if (typeof map !== "object" || map === null || !("mappings" in map)) return undefined;
  const mappings: unknown = map.mappings;
  return typeof mappings === "string" ? mappings : undefined;
}

/** 1-based line, 0-based column, which is what a source map stores. */
function sourceMapPosition(code: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 0;
  for (let index = 0; index < offset; index += 1) {
    if (code.charCodeAt(index) === 10) {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/** The mapping segment at or before `column` on the 1-based `line`. */
function originAt(
  mappings: string,
  line: number,
  column: number,
): { line: number; column: number } | undefined {
  const rows = mappings.split(";");
  let sourceIndex = 0;
  let originLine = 0;
  let originColumn = 0;
  let best: { line: number; column: number } | undefined;
  const last = line - 1;
  for (let rowIndex = 0; rowIndex < rows.length && rowIndex <= last; rowIndex += 1) {
    const row = rows[rowIndex] ?? "";
    let generated = 0;
    let cursor = 0;
    while (cursor < row.length) {
      if (row.charAt(cursor) === ",") {
        cursor += 1;
        continue;
      }
      const generatedField = readVlq(row, cursor);
      if (generatedField === undefined) return undefined;
      cursor = generatedField.next;
      generated += generatedField.value;
      if (cursor >= row.length || row.charAt(cursor) === ",") continue;
      const sourceField = readVlq(row, cursor);
      if (sourceField === undefined) return undefined;
      cursor = sourceField.next;
      sourceIndex += sourceField.value;
      if (sourceIndex < 0) return undefined;
      const lineField = readVlq(row, cursor);
      if (lineField === undefined) return undefined;
      cursor = lineField.next;
      originLine += lineField.value;
      const columnField = readVlq(row, cursor);
      if (columnField === undefined) return undefined;
      cursor = columnField.next;
      originColumn += columnField.value;
      if (cursor < row.length && row.charAt(cursor) !== ",") {
        const nameField = readVlq(row, cursor);
        if (nameField === undefined) return undefined;
        cursor = nameField.next;
      }
      if (rowIndex === last && generated <= column) {
        best = { line: originLine + 1, column: originColumn };
      }
    }
  }
  return best;
}

function stringSource(): string {
  return [
    `import { defineLayers } from "${SPECIFIER}";`,
    "const Layers = defineLayers({ wall: 1 << 2 });",
    'const label = "Layers.wall";',
    "useStaticBody({ layer: Layers.wall + /*@map*/ kept });",
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
    const source = stringSource();
    await withServer(source, 1, async (server) => {
      const result = await server.transformRequest(MODULE_ID);
      const code = result?.code ?? "";
      expect(code).toContain('const label = "Layers.wall";');
      expect(code).toContain("layer: 4");
      expect(code).not.toContain("layer: Layers");
      const mappings = readMappings(result?.map);
      expect(mappings).toBeDefined();
      if (mappings === undefined) return;
      const marker = "/*@map*/";
      const at = source.indexOf(marker);
      expect(at).toBeGreaterThanOrEqual(0);
      const after = at + marker.length;
      const match = /^(\s*)([A-Za-z_$][\w$]*)/.exec(source.slice(after));
      expect(match).not.toBeNull();
      if (match === null) return;
      const spaces = match[1] ?? "";
      const token = match[2] ?? "";
      const original = sourceMapPosition(source, after + spaces.length);
      const outAt = code.indexOf(token);
      expect(outAt).toBeGreaterThanOrEqual(0);
      const generated = sourceMapPosition(code, outAt);
      const mapped = originAt(mappings, generated.line, generated.column);
      expect(mapped?.line).toBe(original.line);
      expect(mapped?.column).toBe(original.column);
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
