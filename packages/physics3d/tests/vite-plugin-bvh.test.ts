/**
 * @file gwen:bvh-prebake through the real Vite pipeline.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build, createServer, type Plugin, type ViteDevServer } from "vite";
import { afterEach, expect, it } from "vitest";
import { gwen } from "@gwenjs/vite";
import { _setBuildToolsLoader, physics3dVitePlugin } from "../src/vite-plugin.js";

const BAKED = new Uint8Array([0x62, 0x76, 0x68, 0x01]);
const GLB = new Uint8Array([1, 2, 3, 4]);
const GLB_B = new Uint8Array([5, 6, 7, 8]);
const SPECIFIER = "@gwenjs/physics3d";
const STUB = "export function useMeshCollider() {}\nexport function useConvexCollider() {}\n";
const MESH = `import { useMeshCollider } from "${SPECIFIER}";
export const anchor = useMeshCollider("./x.glb");
export const value = 1 + /*@map*/ kept;
`;

const roots: string[] = [];

afterEach(() => {
  _setBuildToolsLoader(async () => ({
    build_bvh_from_glb: () => new Uint8Array([0]),
  }));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixedLoader(): void {
  _setBuildToolsLoader(async () => ({
    build_bvh_from_glb: () => BAKED,
  }));
}

function project(files: Record<string, string | Uint8Array>): string {
  const root = mkdtempSync(join(tmpdir(), "gwen-bvh-"));
  roots.push(root);
  for (const [rel, data] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  writeFileSync(join(root, "src", "physics-stub.ts"), STUB);
  return root;
}

function assetName(bytes: Uint8Array): string {
  return `bvh-${createHash("md5").update(bytes).digest("hex").slice(0, 8)}.bin`;
}

function bvhCall(name: string): string {
  return `useMeshCollider({ __bvhUrl: "${name}" })`;
}

function pipelineOf(): Plugin {
  const pipeline = gwen().find((plugin) => plugin.name === "gwen:transform-pipeline");
  expect(pipeline?.name).toBe("gwen:transform-pipeline");
  if (pipeline === undefined) throw new Error("gwen:transform-pipeline is absent");
  return pipeline;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unitNames(plugin: Plugin): string[] {
  const api: unknown = plugin.api;
  if (!isRecord(api) || !Array.isArray(api["names"])) return [];
  const found: string[] = [];
  for (const name of api["names"]) {
    if (typeof name === "string") found.push(name);
  }
  return found;
}

interface BundleAsset {
  readonly fileName: string;
  readonly source: Uint8Array | string;
}

function bundleParts(result: unknown): { code: string; assets: BundleAsset[] } {
  const outputs = Array.isArray(result) ? result : [result];
  const codes: string[] = [];
  const assets: BundleAsset[] = [];
  for (const output of outputs) {
    if (!isRecord(output)) continue;
    const files = output["output"];
    if (!Array.isArray(files)) continue;
    for (const file of files) {
      if (!isRecord(file)) continue;
      if (file["type"] === "chunk" && typeof file["code"] === "string") codes.push(file["code"]);
      if (file["type"] !== "asset" || typeof file["fileName"] !== "string") continue;
      const source = file["source"];
      if (typeof source !== "string" && !(source instanceof Uint8Array)) continue;
      assets.push({ fileName: file["fileName"], source });
    }
  }
  return { code: codes.join("\n"), assets };
}

function sameBytes(source: Uint8Array | string | undefined, expected: Uint8Array): boolean {
  if (source === undefined) return false;
  const actual = typeof source === "string" ? Buffer.from(source) : source;
  if (actual.byteLength !== expected.byteLength) return false;
  for (let index = 0; index < expected.byteLength; index += 1) {
    if (actual[index] !== expected[index]) return false;
  }
  return true;
}

function visitError(error: unknown, visit: (record: Record<string, unknown>) => void): void {
  const seen = new Set<unknown>();
  const walk = (current: unknown): void => {
    if (!isRecord(current) || seen.has(current)) return;
    seen.add(current);
    visit(current);
    walk(current["cause"]);
    const nested = current["errors"];
    if (!Array.isArray(nested)) return;
    for (const item of nested) walk(item);
  };
  walk(error);
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  visitError(error, (record) => {
    if (typeof record["message"] === "string") parts.push(record["message"]);
  });
  return parts.join("\n");
}

function errorCode(error: unknown): string | undefined {
  const codes: string[] = [];
  visitError(error, (record) => {
    if (typeof record["code"] === "string") codes.push(record["code"]);
  });
  return codes.find((code) => code.startsWith("VITE:")) ?? codes[0];
}

function causeReaches(error: unknown, target: Error): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (isRecord(current) && !seen.has(current)) {
    if (current === target) return true;
    seen.add(current);
    current = current["cause"];
  }
  return false;
}

async function withServer(
  root: string,
  plugins: Plugin[],
  run: (server: ViteDevServer, pipeline: Plugin) => Promise<void>,
  config?: { readonly base: string },
): Promise<void> {
  const pipeline = pipelineOf();
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      appType: "custom",
      plugins: [pipeline, ...plugins],
      resolve: { alias: [{ find: SPECIFIER, replacement: join(root, "src", "physics-stub.ts") }] },
      server: { middlewareMode: true, hmr: false, fs: { strict: false } },
      ...(config === undefined ? {} : { base: config.base }),
    });
    await run(server, pipeline);
  } finally {
    await server?.close();
  }
}

function buildRoot(
  root: string,
  plugins: Plugin[],
  input: string | Record<string, string>,
): Promise<unknown> {
  return build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [pipelineOf(), ...plugins],
    build: {
      write: false,
      minify: false,
      rollupOptions: { input, external: [SPECIFIER] },
    },
  });
}

function getPath(
  port: number,
  path: string,
  method = "GET",
): Promise<{ status: number; body: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: new Uint8Array(Buffer.concat(chunks)),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function withHttp(
  server: ViteDevServer,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const http: Server = createHttpServer(server.middlewares);
  try {
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(0, "127.0.0.1", () => resolve());
    });
    const address = http.address();
    if (address === null || typeof address === "string") throw new Error("http port is absent");
    await run(address.port);
  } finally {
    if (http.listening) {
      await new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
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
      return { value: (result & 1) === 1 ? -magnitude : magnitude, next: index };
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
  if (!isRecord(map) || typeof map["mappings"] !== "string") return undefined;
  return map["mappings"];
}

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

it('build rewrites useMeshCollider("./x.glb") to a __bvhUrl call and emits that asset once', async () => {
  fixedLoader();
  const root = project({ "src/game.ts": MESH, "src/x.glb": GLB });
  const name = assetName(BAKED);
  const built = bundleParts(
    await buildRoot(root, [physics3dVitePlugin({ bvhPrebake: true })], join(root, "src/game.ts")),
  );
  const matches = built.assets.filter((asset) => asset.fileName === name);
  expect(built.code).toContain(bvhCall(name));
  expect(matches).toHaveLength(1);
  const asset = matches[0];
  expect(asset !== undefined && sameBytes(asset.source, BAKED)).toBe(true);
});

it('useConvexCollider("./x.glb") is untouched while the useMeshCollider anchor is rewritten', async () => {
  fixedLoader();
  const source = `import { useConvexCollider, useMeshCollider } from "@gwenjs/physics3d";
export const rock = useConvexCollider("./x.glb");
export const anchor = useMeshCollider("./anchor.glb");
`;
  const root = project({ "src/game.ts": source, "src/x.glb": GLB, "src/anchor.glb": GLB });
  await withServer(root, [physics3dVitePlugin({ bvhPrebake: true })], async (server) => {
    const result = await server.transformRequest("/src/game.ts");
    const code = result?.code ?? "";
    expect(code).toContain('useConvexCollider("./x.glb")');
    expect(code).toContain(bvhCall(assetName(BAKED)));
  });
});

it("an absent glb raises VITE:BVH_PREBAKE_FAILED naming the absolute path", async () => {
  fixedLoader();
  const source = `import { useMeshCollider } from "@gwenjs/physics3d";
export const anchor = useMeshCollider("./gone.glb");
`;
  const root = project({ "src/game.ts": source });
  const abs = join(root, "src", "gone.glb");
  await withServer(root, [physics3dVitePlugin({ bvhPrebake: true })], async (server) => {
    await expect(server.transformRequest("/src/game.ts")).rejects.toSatisfy((error: unknown) => {
      return errorCode(error) === "VITE:BVH_PREBAKE_FAILED" && errorText(error).includes(abs);
    });
  });
});

it("an absent glb fails the build with VITE:BVH_PREBAKE_FAILED", async () => {
  fixedLoader();
  const source = `import { useMeshCollider } from "@gwenjs/physics3d";
export const anchor = useMeshCollider("./gone.glb");
`;
  const root = project({ "src/game.ts": source });
  const abs = join(root, "src", "gone.glb");
  await expect(
    buildRoot(root, [physics3dVitePlugin({ bvhPrebake: true })], join(root, "src/game.ts")),
  ).rejects.toSatisfy(
    (error: unknown) =>
      errorCode(error) === "VITE:BVH_PREBAKE_FAILED" && errorText(error).includes(abs),
  );
});

it("a throwing bake raises VITE:BVH_PREBAKE_FAILED with the cause", async () => {
  const origin = new Error("bad glb");
  _setBuildToolsLoader(async () => ({
    build_bvh_from_glb: () => {
      throw origin;
    },
  }));
  const root = project({ "src/game.ts": MESH, "src/x.glb": GLB });
  await withServer(root, [physics3dVitePlugin({ bvhPrebake: true })], async (server) => {
    await expect(server.transformRequest("/src/game.ts")).rejects.toSatisfy((error: unknown) => {
      const message = errorText(error);
      return (
        errorCode(error) === "VITE:BVH_PREBAKE_FAILED" &&
        message.includes("./x.glb") &&
        causeReaches(error, origin)
      );
    });
  });
});

it("dev serves the baked asset from memory with the same bytes as the build asset", async () => {
  fixedLoader();
  const root = project({ "src/game.ts": MESH, "src/x.glb": GLB });
  const name = assetName(BAKED);
  const serveCode: { value: string } = { value: "" };
  const buildCode: { value: string } = { value: "" };
  const tap = (slot: { value: string }): Plugin => ({
    name: "test:tap-bvh-code",
    enforce: "post",
    transform(code, id) {
      if (id.endsWith("/src/game.ts") || id.endsWith("\\src\\game.ts")) slot.value = code;
      return null;
    },
  });
  let status = 0;
  let body = new Uint8Array();
  await withServer(
    root,
    [tap(serveCode), physics3dVitePlugin({ bvhPrebake: true })],
    async (server) => {
      await server.transformRequest("/src/game.ts");
      await withHttp(server, async (port) => {
        const response = await getPath(port, `/${name}`);
        status = response.status;
        body = response.body;
      });
    },
  );
  const built = bundleParts(
    await buildRoot(
      root,
      [tap(buildCode), physics3dVitePlugin({ bvhPrebake: true })],
      join(root, "src/game.ts"),
    ),
  );
  const asset = built.assets.find((item) => item.fileName === name);
  expect(serveCode.value).toBe(buildCode.value);
  expect(serveCode.value).toContain(bvhCall(name));
  expect(status).toBe(200);
  expect(sameBytes(body, BAKED)).toBe(true);
  expect(asset !== undefined && sameBytes(asset.source, BAKED)).toBe(true);
});

it("the dev middleware serves only names it baked", async () => {
  const baked = new Uint8Array([0x62, 0x76, 0x68, 0x02]);
  _setBuildToolsLoader(async () => ({
    build_bvh_from_glb: () => baked,
  }));
  const root = project({ "src/game.ts": MESH, "src/x.glb": GLB });
  const name = assetName(baked);
  await withServer(root, [physics3dVitePlugin({ bvhPrebake: true })], async (server) => {
    await server.transformRequest("/src/game.ts");
    await withHttp(server, async (port) => {
      const known = await getPath(port, `/${name}`);
      const unknown = await getPath(port, "/bvh-00000000.bin");
      const parent = await getPath(port, "/../x");
      const encoded = await getPath(port, "/%2e%2e/x");
      expect(known.status).toBe(200);
      expect(sameBytes(known.body, baked)).toBe(true);
      expect(unknown.status).not.toBe(200);
      expect(parent.status).not.toBe(200);
      expect(encoded.status).not.toBe(200);
    });
  });
});

it("the dev middleware strips the query string and honours config.base", async () => {
  fixedLoader();
  const root = project({ "src/game.ts": MESH, "src/x.glb": GLB });
  const name = assetName(BAKED);
  await withServer(
    root,
    [physics3dVitePlugin({ bvhPrebake: true })],
    async (server) => {
      await server.transformRequest("/src/game.ts");
      await withHttp(server, async (port) => {
        const queried = await getPath(port, `/game/${name}?t=1`);
        const unbased = await getPath(port, `/${name}`);
        const posted = await getPath(port, `/game/${name}`, "POST");
        expect(queried.status).toBe(200);
        expect(sameBytes(queried.body, BAKED)).toBe(true);
        expect(unbased.status).not.toBe(200);
        expect(posted.status).not.toBe(200);
      });
    },
    { base: "/game/" },
  );
});

it("the source map keeps the line of a token after the rewrite", async () => {
  fixedLoader();
  const root = project({ "src/game.ts": MESH, "src/x.glb": GLB });
  await withServer(root, [physics3dVitePlugin({ bvhPrebake: true })], async (server) => {
    const result = await server.transformRequest("/src/game.ts");
    const code = result?.code ?? "";
    expect(code).toContain(bvhCall(assetName(BAKED)));
    const mappings = readMappings(result?.map);
    expect(mappings).toBeDefined();
    if (mappings === undefined) return;
    const marker = "/*@map*/";
    const at = MESH.indexOf(marker);
    expect(at).toBeGreaterThanOrEqual(0);
    const after = at + marker.length;
    const match = /^(\s*)([A-Za-z_$][\w$]*)/.exec(MESH.slice(after));
    expect(match).not.toBeNull();
    if (match === null) return;
    const spaces = match[1] ?? "";
    const token = match[2] ?? "";
    const original = sourceMapPosition(MESH, after + spaces.length);
    const outAt = code.indexOf(token);
    expect(outAt).toBeGreaterThanOrEqual(0);
    const generated = sourceMapPosition(code, outAt);
    const mapped = originAt(mappings, generated.line, generated.column);
    expect(mapped?.line).toBe(original.line);
    expect(mapped?.column).toBe(original.column);
  });
});

it("a spread in the options keeps the call untouched", async () => {
  fixedLoader();
  const source = `import { useMeshCollider } from "@gwenjs/physics3d";
const opts = { mesh: "Terrain" };
export const spread = useMeshCollider("./x.glb", { ...opts });
export const anchor = useMeshCollider("./anchor.glb");
`;
  const root = project({ "src/game.ts": source, "src/x.glb": GLB, "src/anchor.glb": GLB });
  await withServer(root, [physics3dVitePlugin({ bvhPrebake: true })], async (server) => {
    const result = await server.transformRequest("/src/game.ts");
    const code = result?.code ?? "";
    expect(code).toContain('useMeshCollider("./x.glb", { ...opts })');
    expect(code).toContain(bvhCall(assetName(BAKED)));
  });
});

it("a non-literal path is untouched and the literal call next to it is rewritten", async () => {
  fixedLoader();
  const source = `import { useMeshCollider } from "@gwenjs/physics3d";
const path = "./v.glb";
export const dynamic = useMeshCollider(path);
export const anchor = useMeshCollider("./x.glb");
`;
  const root = project({ "src/game.ts": source, "src/x.glb": GLB });
  await withServer(root, [physics3dVitePlugin({ bvhPrebake: true })], async (server) => {
    const result = await server.transformRequest("/src/game.ts");
    const code = result?.code ?? "";
    expect(code).toContain("useMeshCollider(path)");
    expect(code).toContain(bvhCall(assetName(BAKED)));
  });
});

it("two calls in one file emit two assets and the same glb twice bakes once", async () => {
  const baked: Uint8Array[] = [];
  _setBuildToolsLoader(async () => ({
    build_bvh_from_glb: (bytes: Uint8Array) => {
      const out = new Uint8Array(bytes.length + 1);
      out.set(bytes);
      out[bytes.length] = baked.length;
      baked.push(out);
      return out;
    },
  }));
  const source = `import { useMeshCollider } from "@gwenjs/physics3d";
export const first = useMeshCollider("./a.glb");
export const again = useMeshCollider("./a.glb");
export const other = useMeshCollider("./b.glb");
`;
  const root = project({ "src/game.ts": source, "src/a.glb": GLB, "src/b.glb": GLB_B });
  const built = bundleParts(
    await buildRoot(root, [physics3dVitePlugin({ bvhPrebake: true })], join(root, "src/game.ts")),
  );
  const firstBake = baked[0];
  const secondBake = baked[1];
  expect(firstBake).toBeDefined();
  expect(secondBake).toBeDefined();
  if (firstBake === undefined || secondBake === undefined) return;
  const nameA = assetName(firstBake);
  const nameB = assetName(secondBake);
  expect(built.assets.filter((asset) => asset.fileName === nameA)).toHaveLength(1);
  expect(built.assets.filter((asset) => asset.fileName === nameB)).toHaveLength(1);
  expect(built.code.split(nameA).length - 1).toBe(2);
  expect(baked).toHaveLength(2);
});

it("two modules baking the same glb emit one asset in the bundle", async () => {
  fixedLoader();
  const source = `import { useMeshCollider } from "@gwenjs/physics3d";
export const anchor = useMeshCollider("./x.glb");
`;
  const root = project({ "src/a.ts": source, "src/b.ts": source, "src/x.glb": GLB });
  const built = bundleParts(
    await buildRoot(root, [physics3dVitePlugin({ bvhPrebake: true })], {
      a: join(root, "src/a.ts"),
      b: join(root, "src/b.ts"),
    }),
  );
  expect(built.assets.filter((asset) => asset.fileName === assetName(BAKED))).toHaveLength(1);
});

it("registers gwen:bvh-prebake only when bvhPrebake is true", async () => {
  fixedLoader();
  const root = project({ "src/game.ts": MESH, "src/x.glb": GLB });
  const count = (plugin: Plugin): number =>
    unitNames(plugin).filter((name) => name === "gwen:bvh-prebake").length;
  await withServer(root, [physics3dVitePlugin()], async (server, pipeline) => {
    const result = await server.transformRequest("/src/game.ts");
    expect(count(pipeline)).toBe(0);
    expect(result?.code ?? "").toContain('useMeshCollider("./x.glb")');
  });
  await withServer(root, [physics3dVitePlugin({ bvhPrebake: true })], async (server, pipeline) => {
    await server.transformRequest("/src/game.ts");
    expect(count(pipeline)).toBe(1);
  });
  await withServer(
    root,
    [physics3dVitePlugin({ bvhPrebake: true }), physics3dVitePlugin({ bvhPrebake: true })],
    async (server, pipeline) => {
      const result = await server.transformRequest("/src/game.ts");
      const code = result?.code ?? "";
      expect(count(pipeline)).toBe(1);
      expect(code.split(bvhCall(assetName(BAKED))).length - 1).toBe(1);
    },
  );
});

it("a changed glb is baked again on the next transform", async () => {
  _setBuildToolsLoader(async () => ({
    build_bvh_from_glb: (bytes: Uint8Array) => bytes,
  }));
  const root = project({ "src/game.ts": MESH, "src/x.glb": GLB });
  const next = new Uint8Array([9, 9, 9, 9]);
  const firstName = assetName(GLB);
  await withServer(root, [physics3dVitePlugin({ bvhPrebake: true })], async (server) => {
    await server.transformRequest("/src/game.ts");
    writeFileSync(join(root, "src/x.glb"), next);
    for (const [id, mod] of server.moduleGraph.idToModuleMap) {
      if (id.endsWith("/src/game.ts") || id.endsWith("\\src\\game.ts")) {
        server.moduleGraph.invalidateModule(mod);
      }
    }
    const second = await server.transformRequest("/src/game.ts");
    expect(second?.code ?? "").toContain(bvhCall(assetName(next)));
    await withHttp(server, async (port) => {
      const oldAsset = await getPath(port, `/${firstName}`);
      expect(oldAsset.status).toBe(200);
      expect(sameBytes(oldAsset.body, GLB)).toBe(true);
    });
  });
});
