// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { runConformanceTests } from "../src/testing/index.js";
import type { RendererService } from "../src/types.js";
import { RENDERER_CONTRACT_VERSION } from "../src/types.js";

function makeCompliantService(): RendererService {
  const elements: Record<string, HTMLElement> = {};
  return {
    name: "renderer:test",
    contractVersion: RENDERER_CONTRACT_VERSION,
    layers: { main: { order: 0 } },
    mount: vi.fn(),
    unmount: vi.fn(),
    resize: vi.fn(),
    getLayerElement: vi.fn((name: string) => {
      if (!elements[name]) elements[name] = document.createElement("div");
      return elements[name]!;
    }),
    setStatsCollector: vi.fn(),
  };
}

describe("runConformanceTests", () => {
  it("passes for a fully compliant service", () => {
    expect(() => runConformanceTests(makeCompliantService())).not.toThrow();
  });

  it("fails when contractVersion is wrong", () => {
    const svc = { ...makeCompliantService(), contractVersion: 999 };
    expect(() => runConformanceTests(svc)).toThrow();
  });

  it("fails when layers is empty", () => {
    const svc = { ...makeCompliantService(), layers: {} };
    expect(() => runConformanceTests(svc)).toThrow();
  });

  it("fails when getLayerElement throws for a declared layer", () => {
    const svc = {
      ...makeCompliantService(),
      getLayerElement: vi.fn(() => {
        throw new Error("not found");
      }),
    };
    expect(() => runConformanceTests(svc)).toThrow();
  });

  it("fails when mount is not a function", () => {
    const svc = { ...makeCompliantService(), mount: "not-a-function" as unknown as () => void };
    expect(() => runConformanceTests(svc)).toThrow();
  });

  it("fails when resize is not a function", () => {
    const svc = { ...makeCompliantService(), resize: null as unknown as () => void };
    expect(() => runConformanceTests(svc)).toThrow();
  });

  it("does not call mount() or unmount() during conformance check", () => {
    const svc = makeCompliantService();
    runConformanceTests(svc);
    expect(svc.mount).not.toHaveBeenCalled();
    expect(svc.unmount).not.toHaveBeenCalled();
  });
});
