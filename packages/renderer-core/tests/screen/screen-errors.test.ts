import { describe, it, expect } from "vitest";
import {
  ScreenErrorCodes,
  ScreenResizeObserverError,
  ScreenViewportNotFoundError,
} from "../../src/screen-errors.js";

describe("ScreenErrorCodes", () => {
  it("has the expected namespace prefix on all codes", () => {
    for (const code of Object.values(ScreenErrorCodes)) {
      expect(code).toMatch(/^SCREEN:/);
    }
  });

  it("exposes ResizeObserverNotAvailable", () => {
    expect(ScreenErrorCodes.ResizeObserverNotAvailable).toBe(
      "SCREEN:RESIZE_OBSERVER_NOT_AVAILABLE",
    );
  });

  it("exposes ViewportNotFound", () => {
    expect(ScreenErrorCodes.ViewportNotFound).toBe("SCREEN:VIEWPORT_NOT_FOUND");
  });
});

describe("ScreenResizeObserverError", () => {
  it("is an instance of Error", () => {
    expect(new ScreenResizeObserverError()).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    expect(new ScreenResizeObserverError().name).toBe("ScreenResizeObserverError");
  });

  it("carries the error code", () => {
    expect(new ScreenResizeObserverError().code).toBe(ScreenErrorCodes.ResizeObserverNotAvailable);
  });

  it("has a hint and docsUrl", () => {
    const err = new ScreenResizeObserverError();
    expect(err.hint).toBeTruthy();
    expect(err.docsUrl).toContain("gwenengine.dev");
  });
});

describe("ScreenViewportNotFoundError", () => {
  it("is an instance of Error", () => {
    expect(new ScreenViewportNotFoundError("foo", ["main"])).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    expect(new ScreenViewportNotFoundError("foo", ["main"]).name).toBe(
      "ScreenViewportNotFoundError",
    );
  });

  it("carries the error code", () => {
    expect(new ScreenViewportNotFoundError("foo", ["main"]).code).toBe(
      ScreenErrorCodes.ViewportNotFound,
    );
  });

  it("includes the unknown viewport id in the message", () => {
    const err = new ScreenViewportNotFoundError("unknown-vp", ["main", "hud"]);
    expect(err.message).toContain("unknown-vp");
  });

  it("includes known viewport ids in the message", () => {
    const err = new ScreenViewportNotFoundError("foo", ["main", "minimap"]);
    expect(err.message).toContain("main");
    expect(err.message).toContain("minimap");
  });

  it("exposes viewportId and knownViewports", () => {
    const err = new ScreenViewportNotFoundError("foo", ["main"]);
    expect(err.viewportId).toBe("foo");
    expect(err.knownViewports).toEqual(["main"]);
  });
});
