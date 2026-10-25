// packages/camera-core/tests/errors.test.ts
import { GwenError } from "@gwenjs/schema";
import { describe, it, expect } from "vitest";
import {
  CameraErrorCodes,
  CameraViewportNotFoundError,
  CameraEmptyPathError,
} from "../src/errors.js";

describe("CameraViewportNotFoundError", () => {
  it("has the correct code", () => {
    const err = new CameraViewportNotFoundError("minimap");
    expect(err.code).toBe(CameraErrorCodes.VIEWPORT_NOT_FOUND);
  });

  it("message includes the viewport id", () => {
    const err = new CameraViewportNotFoundError("minimap");
    expect(err.message).toContain("minimap");
  });

  it("hint includes the viewport id", () => {
    const err = new CameraViewportNotFoundError("minimap");
    if (__GWEN_DEV__) expect(err.hint).toContain("minimap");
    else expect(err.hint).toBeUndefined();
  });

  it("is an instance of Error", () => {
    expect(new CameraViewportNotFoundError("x")).toBeInstanceOf(Error);
  });

  it("name is CameraViewportNotFoundError", () => {
    expect(new CameraViewportNotFoundError("x").name).toBe("CameraViewportNotFoundError");
  });
});

describe("CameraEmptyPathError", () => {
  it("has the correct code", () => {
    const err = new CameraEmptyPathError();
    expect(err.code).toBe(CameraErrorCodes.EMPTY_PATH);
  });

  it("is an instance of Error", () => {
    expect(new CameraEmptyPathError()).toBeInstanceOf(Error);
  });

  it("name is CameraEmptyPathError", () => {
    expect(new CameraEmptyPathError().name).toBe("CameraEmptyPathError");
  });
});

describe("camera error grammar", () => {
  function assertDocs(error: GwenError, docsUrl: string): void {
    expect(error).toBeInstanceOf(GwenError);
    expect(error.docsUrl).toBe(docsUrl);
    expect(error.docsUrl).not.toContain("gwen" + "engine");
  }

  it.runIf(__GWEN_DEV__)("camera errors derive docsUrl and keep the hint dev-only (dev)", () => {
    const missing = new CameraViewportNotFoundError("minimap");
    const empty = new CameraEmptyPathError();
    assertDocs(missing, "https://gwenjs.github.io/gwen/api/errors#camera-viewport-not-found");
    assertDocs(empty, "https://gwenjs.github.io/gwen/api/errors#camera-empty-path");
    expect(missing.hint).toContain("minimap");
    expect(missing.message).toContain(`\nFix: ${missing.hint}`);
    expect(empty.hint?.length).toBeGreaterThan(0);
    expect(empty.message).toContain(`\nFix: ${empty.hint}`);
  });

  it.runIf(!__GWEN_DEV__)("camera errors derive docsUrl and keep the hint dev-only (prod)", () => {
    const missing = new CameraViewportNotFoundError("minimap");
    const empty = new CameraEmptyPathError();
    assertDocs(missing, "https://gwenjs.github.io/gwen/api/errors#camera-viewport-not-found");
    assertDocs(empty, "https://gwenjs.github.io/gwen/api/errors#camera-empty-path");
    expect(missing.hint).toBeUndefined();
    expect(empty.hint).toBeUndefined();
    expect(missing.message).not.toContain("Fix:");
    expect(empty.message).not.toContain("Fix:");
  });
});
