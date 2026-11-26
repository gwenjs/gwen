// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import type { GwenEngine } from "@gwenjs/core";
import { GwenError } from "@gwenjs/schema";
import type { GwenErrorPayload } from "@gwenjs/schema";
import * as rendererCore from "../src/index.js";
import { ScreenPlugin } from "../src/screen-plugin.js";
import { MockSizeProvider } from "../src/testing/mock-size-provider.js";
import { recorder, renderHost, rendererPlugin, surface } from "./helpers/render-host.js";

const engines: GwenEngine[] = [];
const roots: HTMLElement[] = [];

async function open(debug = false): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: 32, physicsHz: 60, debug });
  engines.push(engine);
  return engine;
}

function newRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
  for (const root of roots.splice(0)) root.remove();
  document.body.replaceChildren();
  document.body.removeAttribute("style");
});

const REMOVED = [
  "createManagerServices",
  "getOrCreateLayerManager",
  "getOrCreateScreenService",
  "getOrCreateCameraManager",
  "getOrCreateViewportManager",
];

describe("RenderHostPlugin", () => {
  it("is exported from the package root while createManagerServices and the getOrCreate readers are not", () => {
    expect(typeof Reflect.get(rendererCore, "RenderHostPlugin")).toBe("function");
    const exported = Object.keys(rendererCore);
    for (const name of REMOVED) expect(exported).not.toContain(name);
  });

  it("is named gwen:viewports and provides viewportManager, cameraManager and layerManager", () => {
    const plugin = renderHost();
    expect(plugin.name).toBe("gwen:viewports");
    expect(plugin.provides).toEqual(["viewportManager", "cameraManager", "layerManager"]);
  });

  it("registers the configured viewports at engine:init, or a full-screen main", async () => {
    const viewports = {
      p1: { x: 0, y: 0, width: 0.5, height: 1 },
      p2: { x: 0.5, y: 0, width: 0.5, height: 1 },
    };
    const configured = await open();
    await configured.use(renderHost({ container: newRoot(), viewports }));
    await configured.startExternal();
    const manager = configured.inject("viewportManager");
    expect([...manager.getAll().keys()]).toEqual(["p1", "p2"]);
    expect(manager.get("p1")?.region).toEqual(viewports.p1);
    expect(manager.get("p2")?.region).toEqual(viewports.p2);

    for (const options of [{ viewports: undefined }, { viewports: {} }]) {
      const engine = await open();
      await engine.use(renderHost({ container: newRoot(), ...options }));
      await engine.startExternal();
      const main = engine.inject("viewportManager");
      expect([...main.getAll().keys()]).toEqual(["main"]);
      expect(main.get("main")?.region).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    }
  });

  it("mounts each registered renderer once at start, also with two renderer plugins", async () => {
    const engine = await open();
    const root = newRoot();
    const one = recorder();
    const two = recorder();
    await engine.use(renderHost({ container: root }));
    await engine.use(rendererPlugin(surface("renderer:one", 0, one), false));
    await engine.use(rendererPlugin(surface("renderer:two", 1, two), false));
    await engine.startExternal();
    expect([one.mounts, two.mounts]).toEqual([1, 1]);
    expect(root.querySelectorAll("canvas")).toHaveLength(2);
  });

  it("mounts into document.body when no container is given", async () => {
    const engine = await open();
    const rec = recorder();
    await engine.use(renderHost());
    await engine.use(rendererPlugin(surface("renderer:one", 0, rec), false));
    await engine.startExternal();
    expect(rec.mounts).toBe(1);
    expect(rec.canvas?.parentElement).toBe(document.body);
  });

  it("mounts a renderer plugin installed after start at once", async () => {
    const engine = await open();
    const root = newRoot();
    const late = recorder();
    await engine.use(renderHost({ container: root }));
    await engine.startExternal();
    await engine.use(rendererPlugin(surface("renderer:late", 0, late), false));
    expect(late.mounts).toBe(1);
    expect(root.querySelector('[data-gwen-layer="renderer:late:scene"]')).toBe(late.canvas);
    await engine.advance(1 / 60);
    expect(late.renders).toHaveLength(1);
  });

  it("sizes every renderer from the screen size provider, dpr included, and keeps the last size for a late renderer", async () => {
    const engine = await open();
    const provider = MockSizeProvider({ width: 800, height: 600 });
    const emit: (width: number, height: number, dpr?: number) => void = provider.emit;
    const early = recorder();
    const late = recorder();
    await engine.use(renderHost({ container: newRoot() }));
    await engine.use(ScreenPlugin({ sizeProvider: provider }));
    await engine.use(rendererPlugin(surface("renderer:early", 0, early), false));
    await engine.startExternal();
    expect(early.resizes).toEqual([[800, 600, 1]]);
    emit(1024, 768, 2);
    expect(early.resizes).toEqual([
      [800, 600, 1],
      [1024, 768, 2],
    ]);
    expect(engine.inject("screenService").devicePixelRatio).toBe(2);
    await engine.use(rendererPlugin(surface("renderer:late", 1, late), false));
    expect(late.resizes).toEqual([[1024, 768, 2]]);
  });

  it("engine.stop unmounts every renderer and removes every canvas, also from a plugin with no teardown", async () => {
    const engine = await open();
    const root = newRoot();
    const kept = recorder();
    const bare = recorder();
    await engine.use(renderHost({ container: root }));
    await engine.use(rendererPlugin(surface("renderer:kept", 0, kept), true));
    await engine.use(rendererPlugin(surface("renderer:bare", 1, bare), false));
    await engine.startExternal();
    expect(root.querySelectorAll("[data-gwen-layer]")).toHaveLength(2);
    await engine.stop();
    expect([kept.unmounts, bare.unmounts]).toEqual([1, 1]);
    expect(root.querySelectorAll("[data-gwen-layer]")).toHaveLength(0);
  });

  it("two engines keep separate roots: stopping one leaves the other canvas connected", async () => {
    const left = await open();
    const right = await open();
    const leftRoot = newRoot();
    const rightRoot = newRoot();
    const onLeft = recorder();
    const onRight = recorder();
    await left.use(renderHost({ container: leftRoot }));
    await left.use(rendererPlugin(surface("renderer:one", 0, onLeft), false));
    await right.use(renderHost({ container: rightRoot }));
    await right.use(rendererPlugin(surface("renderer:one", 0, onRight), false));
    await left.startExternal();
    await right.startExternal();
    await left.stop();
    expect(leftRoot.querySelectorAll("[data-gwen-layer]")).toHaveLength(0);
    expect(onRight.canvas?.isConnected).toBe(true);
    expect(rightRoot.querySelectorAll("[data-gwen-layer]")).toHaveLength(1);
    expect(onRight.unmounts).toBe(0);
  });

  it("calls renderViews with engine.frame.alpha", async () => {
    const engine = await open();
    const rec = recorder();
    await engine.use(renderHost({ container: newRoot() }));
    await engine.use(rendererPlugin(surface("renderer:one", 0, rec), false));
    await engine.startExternal();
    await engine.advance(1 / 120);
    await engine.advance(1 / 120);
    expect(rec.renders.map((render) => render.alpha)).toEqual([0.5, 0]);
  });

  it("reports a renderer whose mount throws on engine.errors, unregisters it and still mounts the others", async () => {
    const engine = await open();
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });
    const root = newRoot();
    const boom = new Error("no webgl");
    const bad = recorder();
    const good = recorder();
    await engine.use(renderHost({ container: root }));
    await engine.use(rendererPlugin(surface("renderer:bad", 0, bad, { error: boom }), false));
    await engine.use(rendererPlugin(surface("renderer:good", 1, good), false));
    await expect(engine.startExternal()).resolves.toBeUndefined();
    expect(events).toHaveLength(1);
    expect(events[0]?.code).toBe("RENDERER:MOUNT_FAILED");
    expect(events[0]?.error).toBe(boom);
    expect(events[0]?.level).toBe("error");
    const layers = engine.inject("layerManager");
    expect(layers.has("renderer:bad")).toBe(false);
    expect(layers.has("renderer:good")).toBe(true);
    expect(good.mounts).toBe(1);
    expect(root.querySelectorAll('[data-gwen-layer^="renderer:bad:"]')).toHaveLength(0);
  });

  it("reports the code of a GwenError thrown by mount instead of its own", async () => {
    const engine = await open();
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });
    const thrown = new GwenError("RENDERER_THREE:WEBGL_UNAVAILABLE", "No WebGL2 context.");
    await engine.use(renderHost({ container: newRoot() }));
    await engine.use(
      rendererPlugin(surface("renderer:three", 0, recorder(), { error: thrown }), false),
    );
    await engine.startExternal();
    expect(events.map((event) => [event.code, event.error])).toEqual([
      ["RENDERER_THREE:WEBGL_UNAVAILABLE", thrown],
    ]);
  });

  it("enables renderer stats when the engine is in debug mode", async () => {
    const engine = await open(true);
    const rec = recorder();
    await engine.use(renderHost({ container: newRoot() }));
    await engine.use(rendererPlugin(surface("renderer:one", 0, rec), false));
    await engine.startExternal();
    expect(rec.collectors).toBe(__GWEN_DEV__ ? 1 : 0);
  });
});
