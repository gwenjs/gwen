import { describe, it, expect } from "vitest";
import {
  RendererErrorCodes,
  RendererAlreadyRegisteredError,
  RendererContractVersionError,
  UnknownLayerError,
} from "../src/errors.js";

describe("RendererErrorCodes", () => {
  it("has the expected namespace prefix on all codes", () => {
    for (const code of Object.values(RendererErrorCodes)) {
      expect(code).toMatch(/^RENDERER:/);
    }
  });

  it("exposes all required codes", () => {
    expect(RendererErrorCodes.ALREADY_REGISTERED).toBe("RENDERER:ALREADY_REGISTERED");
    expect(RendererErrorCodes.CONTRACT_VERSION).toBe("RENDERER:CONTRACT_VERSION");
    expect(RendererErrorCodes.UNKNOWN_LAYER).toBe("RENDERER:UNKNOWN_LAYER");
    expect(RendererErrorCodes.LAYER_ORDER_CONFLICT).toBe("RENDERER:LAYER_ORDER_CONFLICT");
    expect(RendererErrorCodes.MISSING_LAYER).toBe("RENDERER:MISSING_LAYER");
  });
});

describe("RendererAlreadyRegisteredError", () => {
  it("is an instance of Error", () => {
    const err = new RendererAlreadyRegisteredError("renderer:canvas");
    expect(err).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    const err = new RendererAlreadyRegisteredError("renderer:canvas");
    expect(err.name).toBe("RendererAlreadyRegisteredError");
  });

  it("includes the renderer name in the message", () => {
    const err = new RendererAlreadyRegisteredError("renderer:canvas");
    expect(err.message).toContain("renderer:canvas");
  });

  it("has the correct error code", () => {
    const err = new RendererAlreadyRegisteredError("renderer:canvas");
    expect(err.code).toBe(RendererErrorCodes.ALREADY_REGISTERED);
  });

  it("has a non-empty hint and docsUrl", () => {
    const err = new RendererAlreadyRegisteredError("renderer:canvas");
    expect(err.hint.length).toBeGreaterThan(0);
    expect(err.docsUrl.length).toBeGreaterThan(0);
  });

  it("exposes rendererName as a public field", () => {
    const err = new RendererAlreadyRegisteredError("renderer:canvas");
    expect(err.rendererName).toBe("renderer:canvas");
  });
});

describe("RendererContractVersionError", () => {
  it("includes both version numbers in the message", () => {
    const err = new RendererContractVersionError("renderer:canvas", 2, 1);
    expect(err.message).toContain("2");
    expect(err.message).toContain("1");
    expect(err.message).toContain("renderer:canvas");
  });

  it("has the correct error code", () => {
    const err = new RendererContractVersionError("renderer:canvas", 2, 1);
    expect(err.code).toBe(RendererErrorCodes.CONTRACT_VERSION);
  });

  it("is an instance of Error", () => {
    const err = new RendererContractVersionError("renderer:canvas", 2, 1);
    expect(err).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    const err = new RendererContractVersionError("renderer:canvas", 2, 1);
    expect(err.name).toBe("RendererContractVersionError");
  });

  it("exposes actual and expected as public fields", () => {
    const err = new RendererContractVersionError("renderer:canvas", 2, 1);
    expect(err.actual).toBe(2);
    expect(err.expected).toBe(1);
    expect(err.rendererName).toBe("renderer:canvas");
  });
});

describe("UnknownLayerError", () => {
  it("includes layer name and renderer name in the message", () => {
    const err = new UnknownLayerError("hud", "renderer:html");
    expect(err.message).toContain("hud");
    expect(err.message).toContain("renderer:html");
  });

  it("has the correct error code", () => {
    const err = new UnknownLayerError("hud", "renderer:html");
    expect(err.code).toBe(RendererErrorCodes.UNKNOWN_LAYER);
  });

  it("is an instance of Error", () => {
    const err = new UnknownLayerError("hud", "renderer:html");
    expect(err).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    const err = new UnknownLayerError("hud", "renderer:html");
    expect(err.name).toBe("UnknownLayerError");
  });

  it("exposes layerName and rendererName as public fields", () => {
    const err = new UnknownLayerError("hud", "renderer:html");
    expect(err.layerName).toBe("hud");
    expect(err.rendererName).toBe("renderer:html");
  });
});
