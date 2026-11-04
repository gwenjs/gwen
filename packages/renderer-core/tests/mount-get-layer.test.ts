// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { defineRendererService } from "../src/define-renderer-service.js";
import { UnknownLayerError } from "../src/errors.js";

function makeRenderer() {
  const created: HTMLElement[] = [];
  const mounted: HTMLElement[] = [];
  const Renderer = defineRendererService<{ layers: Record<string, { order: number }> }>((opts) => ({
    name: "renderer:mount-get-layer",
    layers: opts.layers,
    createElement: () => {
      const el = document.createElement("canvas");
      created.push(el);
      return el;
    },
    mount: (ctx) => {
      mounted.push(ctx.getLayer("game"));
    },
    unmount: () => {},
    resize: () => {},
    flush: () => {},
  }));
  return { service: Renderer({ layers: { game: { order: 10 } } }), created, mounted };
}

describe("mount getLayer", () => {
  it("creates the element of a layer that no getLayerElement call has created yet", () => {
    const { service, created, mounted } = makeRenderer();
    service.mount(document.createElement("div"));
    expect(mounted).toHaveLength(1);
    expect(mounted[0]).toBe(created[0]);
    expect(service.getLayerElement("game")).toBe(mounted[0]);
    expect(created).toHaveLength(1);
  });

  it("returns the element that getLayerElement created before the mount", () => {
    const { service, created, mounted } = makeRenderer();
    const first = service.getLayerElement("game");
    service.mount(document.createElement("div"));
    expect(mounted[0]).toBe(first);
    expect(created).toHaveLength(1);
  });

  it("rejects a layer that the definition does not declare", () => {
    const Renderer = defineRendererService<{ layers: Record<string, { order: number }> }>(
      (opts) => ({
        name: "renderer:mount-unknown-layer",
        layers: opts.layers,
        createElement: () => document.createElement("canvas"),
        mount: (ctx) => {
          ctx.getLayer("missing");
        },
        unmount: () => {},
        resize: () => {},
        flush: () => {},
      }),
    );
    const service = Renderer({ layers: { game: { order: 10 } } });
    expect(() => service.mount(document.createElement("div"))).toThrow(UnknownLayerError);
  });
});
