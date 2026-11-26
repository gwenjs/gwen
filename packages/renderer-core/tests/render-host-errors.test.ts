import { describe, expect, it } from "vitest";
import { RendererErrorCodes } from "../src/errors.js";

describe("render host error codes", () => {
  it("RENDERER:MOUNT_FAILED is a code and FOREIGN_LAYER_MANAGER is gone", () => {
    expect(Reflect.get(RendererErrorCodes, "MOUNT_FAILED")).toBe("RENDERER:MOUNT_FAILED");
    expect(Reflect.get(RendererErrorCodes, "FOREIGN_LAYER_MANAGER")).toBeUndefined();
  });
});
