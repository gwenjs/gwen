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
import { build, createServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
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
