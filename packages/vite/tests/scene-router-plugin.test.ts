import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { gwenSceneRouterPlugin, transformRouterNames } from "../src/plugins/scene-router.js";

describe("transformRouterNames()", () => {
  it("injects __routerName__ for const declaration", () => {
    const input = `export const AppRouter = defineSceneRouter({ initial: 'menu', routes: {} })`;
    const output = transformRouterNames(input);
    expect(output).toContain("Object.assign");
    expect(output).toContain("__routerName__");
    expect(output).toContain('"AppRouter"');
  });

  it("handles multiline defineSceneRouter call", () => {
    const input = `
export const MyRouter = defineSceneRouter({
  initial: 'start',
  routes: { start: { scene: StartScene, on: {} } }
})`;
    const output = transformRouterNames(input);
    expect(output).toContain("__routerName__");
    expect(output).toContain('"MyRouter"');
  });

  it("does not transform files without defineSceneRouter", () => {
    const input = `export const x = 42;`;
    expect(transformRouterNames(input)).toBe(input);
  });
});

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("gwenSceneRouterPlugin()", () => {
  it("gwenSceneRouterPlugin() serves index.html without a router devtools script", async () => {
    const root = mkdtempSync(join(tmpdir(), "gwen-scene-router-"));
    dirs.push(root);
    const html = "<!doctype html><html><head><title>t</title></head><body></body></html>";
    const withPlugin = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      appType: "custom",
      plugins: [gwenSceneRouterPlugin()],
      server: { middlewareMode: true, hmr: false },
    });
    let bare: ViteDevServer | undefined;
    try {
      bare = await createServer({
        configFile: false,
        root,
        logLevel: "silent",
        appType: "custom",
        plugins: [],
        server: { middlewareMode: true, hmr: false },
      });
      const served = await withPlugin.transformIndexHtml("/index.html", html);
      const plain = await bare.transformIndexHtml("/index.html", html);
      expect(served).not.toContain("__GWEN_ROUTER");
      expect(served).toBe(plain);
    } finally {
      await Promise.all([withPlugin.close(), bare?.close()]);
    }
  });
});

describe("scene-router module", () => {
  it("scene-router module no longer exports generateRouterDevtools", async () => {
    const mod = await import("../src/plugins/scene-router.js");
    expect(Object.keys(mod).sort()).toEqual(["gwenSceneRouterPlugin", "transformRouterNames"]);
  });
});
