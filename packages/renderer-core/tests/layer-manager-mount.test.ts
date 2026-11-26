// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import type { GwenEngine } from "@gwenjs/core";
import type { GwenErrorPayload } from "@gwenjs/schema";
import { LayerManager } from "../src/layer-manager.js";
import { recorder, surface } from "./helpers/render-host.js";

const engines: GwenEngine[] = [];
const roots: HTMLElement[] = [];

async function open(): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: 32, physicsHz: 60 });
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
});

describe("LayerManager mount rules", () => {
  it("a second mount() mounts each renderer once", async () => {
    const engine = await open();
    const manager = new LayerManager(newRoot(), undefined, engine);
    const one = recorder();
    const two = recorder();
    manager.register(surface("renderer:one", 0, one));
    manager.register(surface("renderer:two", 1, two));
    manager.mount();
    manager.mount();
    expect([one.mounts, two.mounts]).toEqual([1, 1]);
  });

  it("a renderer registered after mount() is mounted at once and drawn on the next engine:render", async () => {
    const engine = await open();
    const root = newRoot();
    const manager = new LayerManager(root, undefined, engine);
    const early = recorder();
    const late = recorder();
    manager.register(surface("renderer:early", 0, early));
    expect(early.mounts).toBe(0);
    manager.mount();
    expect(early.mounts).toBe(1);
    manager.register(surface("renderer:late", 1, late));
    expect(late.mounts).toBe(1);
    expect(root.querySelector('[data-gwen-layer="renderer:late:scene"]')).toBe(late.canvas);
    await engine.hooks.callHook("engine:render", 0);
    expect(late.renders).toHaveLength(1);
    expect(early.renders).toHaveLength(1);
  });

  it("a renderer registered after mount() receives the last resize", async () => {
    const engine = await open();
    const manager = new LayerManager(newRoot(), undefined, engine);
    const early = recorder();
    const late = recorder();
    manager.register(surface("renderer:early", 0, early));
    manager.mount();
    manager.resize(1024, 768, 2);
    expect(early.resizes).toEqual([[1024, 768, 2]]);
    manager.register(surface("renderer:late", 1, late));
    expect(late.resizes).toEqual([[1024, 768, 2]]);
  });

  it("mount() unregisters a renderer whose mount throws, reports it, and mounts the others", async () => {
    const engine = await open();
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });
    const manager = new LayerManager(newRoot(), undefined, engine);
    const boom = new Error("no webgl");
    const bad = recorder();
    const good = recorder();
    manager.register(surface("renderer:bad", 0, bad, { error: boom }));
    manager.register(surface("renderer:good", 1, good));
    expect(() => manager.mount()).not.toThrow();
    expect(manager.has("renderer:bad")).toBe(false);
    expect(manager.has("renderer:good")).toBe(true);
    expect(good.mounts).toBe(1);
    expect(events.map((event) => [event.code, event.error])).toEqual([
      ["RENDERER:MOUNT_FAILED", boom],
    ]);
  });

  it("renderViews receives engine.frame.alpha of the display frame", async () => {
    const engine = await open();
    const manager = new LayerManager(newRoot(), undefined, engine);
    const rec = recorder();
    manager.register(surface("renderer:one", 0, rec));
    manager.mount();
    await engine.startExternal();
    await engine.advance(1 / 120);
    await engine.advance(1 / 120);
    await engine.advance(1 / 120);
    expect(rec.renders.map((render) => render.alpha)).toEqual([0.5, 0, 0.5]);
  });

  it("dispose() unmounts every renderer, removes its nodes and drops the engine:render hook", async () => {
    const engine = await open();
    const root = newRoot();
    const manager = new LayerManager(root, undefined, engine);
    const one = recorder();
    const two = recorder();
    manager.register(surface("renderer:one", 0, one));
    manager.register(surface("renderer:two", 1, two));
    manager.mount();
    manager.dispose();
    expect([one.unmounts, two.unmounts]).toEqual([1, 1]);
    expect(root.querySelectorAll("[data-gwen-layer]")).toHaveLength(0);
    expect(manager.has("renderer:one")).toBe(false);
    await engine.hooks.callHook("engine:render", 0);
    expect([one.renders.length, two.renders.length]).toEqual([0, 0]);
  });

  it("dispose() releases the other renderers when one unmount() throws, and removes every node", async () => {
    const engine = await open();
    const root = newRoot();
    const manager = new LayerManager(root, undefined, engine);
    const one = recorder();
    const two = recorder();
    manager.register(
      surface("renderer:one", 0, one, undefined, { error: new Error("context lost") }),
    );
    manager.register(surface("renderer:two", 1, two));
    manager.mount();
    expect(root.querySelectorAll("[data-gwen-layer]")).toHaveLength(2);
    expect(() => manager.dispose()).not.toThrow();
    expect([one.unmounts, two.unmounts]).toEqual([1, 1]);
    expect(root.querySelectorAll("[data-gwen-layer]")).toHaveLength(0);
    expect([manager.has("renderer:one"), manager.has("renderer:two")]).toEqual([false, false]);
  });

  it("unregister() rethrows an unmount() failure and still removes the nodes and the entry", async () => {
    const engine = await open();
    const root = newRoot();
    const manager = new LayerManager(root, undefined, engine);
    const rec = recorder();
    const boom = new Error("context lost");
    manager.register(surface("renderer:one", 0, rec, undefined, { error: boom }));
    manager.mount();
    expect(root.querySelectorAll("[data-gwen-layer]")).toHaveLength(1);
    expect(() => manager.unregister("renderer:one")).toThrow(boom);
    expect(root.querySelectorAll("[data-gwen-layer]")).toHaveLength(0);
    expect(manager.has("renderer:one")).toBe(false);
  });

  it("mount() survives a renderer whose mount() and unmount() both throw, and reports one MOUNT_FAILED", async () => {
    const engine = await open();
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });
    const root = newRoot();
    const manager = new LayerManager(root, undefined, engine);
    const mountError = new Error("no webgl");
    const bad = recorder();
    const good = recorder();
    manager.register(
      surface("renderer:bad", 0, bad, { error: mountError }, { error: new Error("not mounted") }),
    );
    manager.register(surface("renderer:good", 1, good));
    expect(() => manager.mount()).not.toThrow();
    expect([bad.mounts, bad.unmounts]).toEqual([1, 1]);
    expect(manager.has("renderer:bad")).toBe(false);
    expect(manager.has("renderer:good")).toBe(true);
    expect(good.mounts).toBe(1);
    expect(root.querySelectorAll("[data-gwen-layer]")).toHaveLength(1);
    expect(events.map((event) => [event.code, event.error])).toEqual([
      ["RENDERER:MOUNT_FAILED", mountError],
    ]);
  });
});
