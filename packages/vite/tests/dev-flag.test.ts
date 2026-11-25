import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { gwen } from "../src/index.js";
import { gwenVitePlugin } from "../src/plugins/index.js";

declare const __GWEN_DEV__: boolean;

const PROBE = `import { GWEN_DEV } from "virtual:gwen/env";

export function readFlags(): { flag: boolean; viteDev: boolean; gwenDev: boolean } {
  const flag = __GWEN_DEV__;
  const viteDev = import.meta.env.DEV;
  return { flag, viteDev, gwenDev: GWEN_DEV };
}

export function devOnly(): void {
  if (__GWEN_DEV__) console.warn("isolated after sentinel");
}

console.log(readFlags, devOnly);
`;

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function readDist(dir: string): string {
  const parts: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".js")) parts.push(readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return parts.join("\n");
}

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "gwen-dev-flag-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "probe.ts"), PROBE);
  return dir;
}

describe("dev flag follows Vite DEV", () => {
  it.runIf(__GWEN_DEV__)("serve sets __GWEN_DEV__ and GWEN_DEV to true", async () => {
    const root = fixture();
    const server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      appType: "custom",
      plugins: [gwenVitePlugin()],
      server: { middlewareMode: true, hmr: false },
    });
    try {
      const mod = (await server.ssrLoadModule("/src/probe.ts")) as {
        readFlags: () => { flag: boolean; viteDev: boolean; gwenDev: boolean };
      };
      expect(mod.readFlags()).toEqual({ flag: true, viteDev: true, gwenDev: true });
    } finally {
      await server.close();
    }
  });

  it.runIf(__GWEN_DEV__)(
    "build follows the Vite mode: production gives false, development gives true",
    async () => {
      // Vite 8 sets import.meta.env.DEV from NODE_ENV, and `vite build` defaults
      // NODE_ENV to production when it is unset, even with --mode development.
      // The flag follows the mode, whatever NODE_ENV is.
      const cases = [
        { mode: "production", nodeEnv: undefined, expected: false },
        { mode: "production", nodeEnv: "production", expected: false },
        { mode: "development", nodeEnv: undefined, expected: true },
        { mode: "development", nodeEnv: "production", expected: true },
        { mode: "production", nodeEnv: "development", expected: false },
        { mode: "development", nodeEnv: "development", expected: true },
      ] as const;
      const previous = process.env.NODE_ENV;
      try {
        for (const { mode, nodeEnv, expected } of cases) {
          if (nodeEnv === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = nodeEnv;
          const root = fixture();
          await build({
            configFile: false,
            root,
            mode,
            logLevel: "silent",
            plugins: [gwenVitePlugin()],
            build: {
              outDir: "dist",
              emptyOutDir: true,
              minify: false,
              write: true,
              rollupOptions: {
                input: join(root, "src", "probe.ts"),
                output: { entryFileNames: "probe.js", format: "es" },
              },
            },
          });
          const code = readDist(join(root, "dist"));
          const literal = expected ? "true" : "false";
          const label = `mode ${mode}, NODE_ENV ${nodeEnv ?? "unset"}`;
          expect(code, label).toContain(`flag: ${literal}`);
          expect(code, label).toContain(`gwenDev: ${literal}`);
          if (expected) expect(code, label).toContain("isolated after sentinel");
          else expect(code, label).not.toContain("isolated after sentinel");
          expect(code, label).not.toContain("__GWEN_DEV__");
          expect(code, label).not.toContain("import.meta.env");
        }
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
    },
    120_000,
  );
});

const NAMES = `import { defineLayout as layout } from "@gwenjs/core/actor";
import { defineSceneRouter as route } from "@gwenjs/core/scene";
export const Level1 = layout(() => ({}));
export const AppRouter = route({ initial: "menu", routes: {} });
`;

function bundleSource(result: Awaited<ReturnType<typeof build>>): string {
  const groups = Array.isArray(result) ? result : [result];
  const parts: string[] = [];
  for (const group of groups) {
    if (!("output" in group)) continue;
    for (const item of group.output) {
      if (item.type === "chunk") parts.push(item.code);
    }
  }
  return parts.join("\n");
}

describe("names follow the dev flag", () => {
  it.runIf(__GWEN_DEV__)(
    "a production build has no __routerName__ or __layoutName__ and a development build has both",
    async () => {
      for (const mode of ["production", "development"] as const) {
        const root = fixture();
        writeFileSync(join(root, "src", "names.ts"), NAMES);
        const result = await build({
          configFile: false,
          root,
          mode,
          logLevel: "silent",
          plugins: [gwenVitePlugin()],
          build: {
            write: false,
            minify: false,
            rollupOptions: {
              external: [/^@gwenjs\//],
              input: join(root, "src", "names.ts"),
              output: { entryFileNames: "names.js", format: "es" },
            },
          },
        });
        const code = bundleSource(result);
        if (mode === "production") {
          expect(code, mode).not.toContain("__layoutName__");
          expect(code, mode).not.toContain("__routerName__");
        } else {
          expect(code, mode).toContain('__layoutName__: "Level1"');
          expect(code, mode).toContain('__routerName__: "AppRouter"');
        }
        expect(code, mode).not.toContain("__GWEN_DEV__");
      }
    },
    120_000,
  );
});

const pipelineApp = fileURLToPath(new URL("./fixtures/pipeline-app/", import.meta.url));
const coreWasmDir = fileURLToPath(new URL("../../core/wasm/", import.meta.url));

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("the entry binary does not follow the dev flag", () => {
  it("vite build --mode development still imports the release factory and emits the release binary", async () => {
    const result = await build({
      configFile: false,
      root: pipelineApp,
      mode: "development",
      logLevel: "silent",
      plugins: gwen(),
      build: { write: false, minify: false },
    });
    const groups = Array.isArray(result) ? result : [result];
    const wasmHashes: string[] = [];
    for (const group of groups) {
      if (!("output" in group)) continue;
      for (const item of group.output) {
        if (item.type === "asset" && item.fileName.endsWith(".wasm")) {
          wasmHashes.push(sha256(item.source));
        }
      }
    }
    expect(bundleSource(result)).not.toContain("-dev/");
    const release = sha256(readFileSync(join(coreWasmDir, "light", "gwen_core_bg.wasm")));
    const checked = sha256(readFileSync(join(coreWasmDir, "light-dev", "gwen_core_bg.wasm")));
    expect(wasmHashes).toEqual([release]);
    expect(wasmHashes).not.toContain(checked);
  }, 120_000);
});
