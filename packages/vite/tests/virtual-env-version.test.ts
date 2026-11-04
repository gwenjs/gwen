/**
 * Tests @gwenjs/vite
 * Verifies the `GWEN_VERSION` constant of `virtual:gwen/env` when the `version` field of
 * `@gwenjs/core/package.json` is not a string. One case per file: Node caches the resolution of
 * `@gwenjs/core/package.json` for the whole worker.
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
 * Makes `@gwenjs/core/package.json` resolvable for `createRequire` through `NODE_PATH`
 * (the vite package does not depend on core), with the given manifest.
 */
function installCoreManifest(manifest: Record<string, unknown>): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gwen-vite-env-"));
  fs.mkdirSync(path.join(dir, "@gwenjs", "core"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "@gwenjs", "core", "package.json"),
    JSON.stringify({ name: "@gwenjs/core", ...manifest }),
  );
  const previous = process.env.NODE_PATH;
  const initPaths = (): unknown => Reflect.apply(Reflect.get(Module, "_initPaths"), Module, []);
  process.env.NODE_PATH = dir;
  initPaths();
  restore = () => {
    if (previous === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = previous;
    initPaths();
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
    expect(loadEnvModule(gwenVirtualPlugin({}))).toContain("export const GWEN_VERSION = '0.0.0'");
  });
});
