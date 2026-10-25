import { GwenError } from "@gwenjs/schema";
import { describe, it, expect } from "vitest";
import {
  RendererErrorCodes,
  RendererAlreadyRegisteredError,
  RendererContractVersionError,
  EmptyLayersError,
  SurfaceInvalidError,
  LayerOrderConflictError,
  UnknownLayerError,
  UnavailableCameraError,
  ScreenToWorldPerspectiveError,
} from "../src/errors.js";
import {
  ScreenErrorCodes,
  ScreenResizeObserverError,
  ScreenViewportNotFoundError,
} from "../src/screen-errors.js";

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
    expect(RendererErrorCodes.SURFACE_INVALID).toBe("RENDERER:SURFACE_INVALID");
    expect(RendererErrorCodes.UNAVAILABLE_CAMERA).toBe("RENDERER:UNAVAILABLE_CAMERA");
    expect(RendererErrorCodes.SCREEN_TO_WORLD_PERSPECTIVE).toBe(
      "RENDERER:SCREEN_TO_WORLD_PERSPECTIVE",
    );
    expect(RendererErrorCodes.FOREIGN_LAYER_MANAGER).toBe("RENDERER:FOREIGN_LAYER_MANAGER");
    expect(RendererErrorCodes.CONFORMANCE_FAILED).toBe("RENDERER:CONFORMANCE_FAILED");
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
    if (__GWEN_DEV__) expect(err.hint?.length).toBeGreaterThan(0);
    else expect(err.hint).toBeUndefined();
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

describe("UnavailableCameraError", () => {
  it("is an instance of Error", () => {
    expect(new UnavailableCameraError()).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    expect(new UnavailableCameraError().name).toBe("UnavailableCameraError");
  });

  it("has the correct error code", () => {
    expect(new UnavailableCameraError().code).toBe(RendererErrorCodes.UNAVAILABLE_CAMERA);
  });

  it("message includes the viewport id when provided", () => {
    expect(new UnavailableCameraError("main").message).toContain("main");
  });

  it("message is valid when no viewport id is provided", () => {
    const err = new UnavailableCameraError();
    expect(err.message).not.toContain("undefined");
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("exposes viewportId as a public field", () => {
    expect(new UnavailableCameraError("p1").viewportId).toBe("p1");
  });

  it("viewportId is undefined when not provided", () => {
    expect(new UnavailableCameraError().viewportId).toBeUndefined();
  });

  it("has a non-empty hint and docsUrl", () => {
    const err = new UnavailableCameraError();
    if (__GWEN_DEV__) expect(err.hint?.length).toBeGreaterThan(0);
    else expect(err.hint).toBeUndefined();
  });
});

describe("ScreenToWorldPerspectiveError", () => {
  it("is an instance of Error", () => {
    expect(new ScreenToWorldPerspectiveError("perspective")).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    expect(new ScreenToWorldPerspectiveError("perspective").name).toBe(
      "ScreenToWorldPerspectiveError",
    );
  });

  it("has the correct error code", () => {
    expect(new ScreenToWorldPerspectiveError("perspective").code).toBe(
      RendererErrorCodes.SCREEN_TO_WORLD_PERSPECTIVE,
    );
  });

  it("includes the projection type in the message", () => {
    expect(new ScreenToWorldPerspectiveError("perspective").message).toContain("perspective");
  });

  it("exposes projectionType as a public field", () => {
    expect(new ScreenToWorldPerspectiveError("perspective").projectionType).toBe("perspective");
  });

  it("has a non-empty hint and docsUrl", () => {
    const err = new ScreenToWorldPerspectiveError("perspective");
    if (__GWEN_DEV__) expect(err.hint?.length).toBeGreaterThan(0);
    else expect(err.hint).toBeUndefined();
  });

  it("hint mentions screenToRay", () => {
    const err = new ScreenToWorldPerspectiveError("perspective");
    if (__GWEN_DEV__) expect(err.hint).toContain("screenToRay");
    else expect(err.hint).toBeUndefined();
  });
});

describe("SurfaceInvalidError", () => {
  it("uses RENDERER:SURFACE_INVALID", () => {
    const err = new SurfaceInvalidError("renderer:surface");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SurfaceInvalidError");
    expect(err.code).toBe(RendererErrorCodes.SURFACE_INVALID);
    expect(err.rendererName).toBe("renderer:surface");
    expect(err.message).toContain("renderer:surface");
  });
});

describe("LayerOrderConflictError", () => {
  it("uses RENDERER:LAYER_ORDER_CONFLICT", () => {
    const err = new LayerOrderConflictError("renderer:surface:scene", "renderer:html:hud", 10);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("LayerOrderConflictError");
    expect(err.code).toBe(RendererErrorCodes.LAYER_ORDER_CONFLICT);
    expect(err.order).toBe(10);
    expect(err.message).toContain("renderer:html:hud");
  });
});

const RENDERER_GRAMMAR = [
  {
    label: "RendererAlreadyRegisteredError",
    docsUrl: "https://gwenjs.github.io/gwen/api/errors#renderer-already-registered",
    make: () => new RendererAlreadyRegisteredError("renderer:canvas"),
  },
  {
    label: "RendererContractVersionError",
    docsUrl: "https://gwenjs.github.io/gwen/api/errors#renderer-contract-version",
    make: () => new RendererContractVersionError("renderer:canvas", 2, 1),
  },
  {
    label: "EmptyLayersError",
    docsUrl: "https://gwenjs.github.io/gwen/api/errors#renderer-missing-layer",
    make: () => new EmptyLayersError("renderer:canvas"),
  },
  {
    label: "SurfaceInvalidError",
    docsUrl: "https://gwenjs.github.io/gwen/api/errors#renderer-surface-invalid",
    make: () => new SurfaceInvalidError("renderer:three"),
  },
  {
    label: "LayerOrderConflictError",
    docsUrl: "https://gwenjs.github.io/gwen/api/errors#renderer-layer-order-conflict",
    make: () => new LayerOrderConflictError("renderer:three:scene", "renderer:html:hud", 0),
  },
  {
    label: "UnknownLayerError",
    docsUrl: "https://gwenjs.github.io/gwen/api/errors#renderer-unknown-layer",
    make: () => new UnknownLayerError("hud", "renderer:html"),
  },
  {
    label: "UnavailableCameraError",
    docsUrl: "https://gwenjs.github.io/gwen/api/errors#renderer-unavailable-camera",
    make: () => new UnavailableCameraError("main"),
  },
  {
    label: "ScreenToWorldPerspectiveError",
    docsUrl: "https://gwenjs.github.io/gwen/api/errors#renderer-screen-to-world-perspective",
    make: () => new ScreenToWorldPerspectiveError("perspective"),
  },
  {
    label: "ScreenResizeObserverError",
    docsUrl:
      "https://gwenjs.github.io/gwen/api/errors#renderer-screen-resize-observer-not-available",
    make: () => new ScreenResizeObserverError(),
  },
  {
    label: "ScreenViewportNotFoundError",
    docsUrl: "https://gwenjs.github.io/gwen/api/errors#renderer-screen-viewport-not-found",
    make: () => new ScreenViewportNotFoundError("p3", ["main"]),
  },
] as const;

describe("renderer error grammar", () => {
  it.each(RENDERER_GRAMMAR)(
    "every renderer error class is a GwenError whose docsUrl is derived from its code ($label)",
    ({ make, docsUrl }) => {
      const err = make();
      expect(err).toBeInstanceOf(GwenError);
      expect(err.docsUrl).toBe(docsUrl);
      expect(err.docsUrl).not.toContain("gwen" + "engine");
    },
  );

  it("the screen codes carry the RENDERER prefix", () => {
    expect(ScreenErrorCodes.ResizeObserverNotAvailable).toBe(
      "RENDERER:SCREEN_RESIZE_OBSERVER_NOT_AVAILABLE",
    );
    expect(ScreenErrorCodes.ViewportNotFound).toBe("RENDERER:SCREEN_VIEWPORT_NOT_FOUND");
    expect(new ScreenResizeObserverError().code).toBe(ScreenErrorCodes.ResizeObserverNotAvailable);
    expect(new ScreenViewportNotFoundError("p3", []).code).toBe(ScreenErrorCodes.ViewportNotFound);
  });

  it.runIf(!__GWEN_DEV__)("a renderer error has no Fix line in production", () => {
    for (const { make } of RENDERER_GRAMMAR) {
      const err = make();
      expect(err.hint).toBeUndefined();
      expect(err.message).not.toContain("Fix:");
    }
  });

  it.runIf(__GWEN_DEV__)("a renderer error has a Fix line in development", () => {
    for (const { make } of RENDERER_GRAMMAR) {
      const err = make();
      expect(typeof err.hint).toBe("string");
      expect(err.hint?.length).toBeGreaterThan(0);
      expect(err.message).toContain(`\nFix: ${err.hint}`);
    }
  });

  it("every renderer error keeps its domain fields", () => {
    expect(new RendererAlreadyRegisteredError('say "hi"').rendererName).toBe('say "hi"');
    const version = new RendererContractVersionError("renderer:canvas", 0, 1);
    expect(version.rendererName).toBe("renderer:canvas");
    expect(version.actual).toBe(0);
    expect(version.expected).toBe(1);
    expect(new EmptyLayersError("").rendererName).toBe("");
    expect(new SurfaceInvalidError('layer "world"').rendererName).toBe('layer "world"');
    const order = new LayerOrderConflictError("left", "right", 0);
    expect(order.left).toBe("left");
    expect(order.right).toBe("right");
    expect(order.order).toBe(0);
    const unknown = new UnknownLayerError("", 'ren "der"');
    expect(unknown.layerName).toBe("");
    expect(unknown.rendererName).toBe('ren "der"');
    expect(new UnavailableCameraError("main").viewportId).toBe("main");
    expect(new UnavailableCameraError().viewportId).toBeUndefined();
    expect(new ScreenToWorldPerspectiveError("perspective").projectionType).toBe("perspective");
    const missing = new ScreenViewportNotFoundError("p3", []);
    expect(missing.viewportId).toBe("p3");
    expect(missing.knownViewports).toEqual([]);
    expect(new ScreenResizeObserverError().code).toBe(ScreenErrorCodes.ResizeObserverNotAvailable);
  });
});
