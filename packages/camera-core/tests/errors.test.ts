// packages/camera-core/tests/errors.test.ts
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
    expect(err.hint).toContain("minimap");
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
