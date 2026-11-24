/**
 * Tests @gwenjs/vite
 * Verifies the `GWEN_VERSION` constant of `virtual:gwen/env` when the `version` field of
 * `@gwenjs/core/package.json` is not a string. `@gwenjs/vite` depends on `@gwenjs/core`; the
 * temporary manifest is installed with `Module._resolveFilename`. One case per file: Node caches
 * the resolution of `@gwenjs/core/package.json` for the whole worker.
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import * as path from "node:path";
import type { Plugin } from "vite";
import { gwenVirtualPlugin } from "../src/plugins/virtual-env";

const ENV_ID = "\0virtual:gwen/env";

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
});

/**
 * Serves `request === "@gwenjs/core/package.json"` from a temporary manifest.
 * `@gwenjs/vite` depends on `@gwenjs/core`, so `NODE_PATH` cannot hide the installed copy.
 * `restore` puts the previous `Module._resolveFilename` back and deletes the manifest.
 */
function installCoreManifest(manifest: Record<string, unknown>): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gwen-vite-env-"));
  const manifestPath = path.join(dir, "@gwenjs", "core", "package.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({ name: "@gwenjs/core", ...manifest }));
  const previous = Reflect.get(Module, "_resolveFilename");
  const resolveFilename = (request: string, ...rest: unknown[]): unknown => {
    if (request === "@gwenjs/core/package.json") return manifestPath;
    return Reflect.apply(previous, Module, [request, ...rest]);
  };
  Reflect.set(Module, "_resolveFilename", resolveFilename);
  restore = () => {
    Reflect.set(Module, "_resolveFilename", previous);
    fs.rmSync(dir, { recursive: true, force: true });
  };
}

function loadEnvModule(plugin: Plugin): string {
  const load = plugin.load;
  if (typeof load !== "function") throw new Error("load hook missing");
  const out: unknown = Reflect.apply(load, {}, [ENV_ID]);
  if (typeof out !== "string") throw new Error("virtual:gwen/env did not load");
  return out;
}

describe("virtual:gwen/env — GWEN_VERSION", () => {
  it("reports 0.0.0 when the core version is not a string", () => {
    installCoreManifest({ version: 7 });
    expect(loadEnvModule(gwenVirtualPlugin())).toContain("export const GWEN_VERSION = '0.0.0'");
  });
});
