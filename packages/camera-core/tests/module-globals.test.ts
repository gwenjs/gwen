import { describe, expect, it } from "vitest";
import * as cameraCore from "../src/index";
import * as cameraCoreInternal from "../src/internal";

describe("camera-core module globals (#59)", () => {
  it("drops the module-global camera stores from every entry (#59)", () => {
    for (const name of ["cameraViewportMap", "cameraPathStore", "cameraMatrixStore"]) {
      expect(name in cameraCore).toBe(false);
      expect(name in cameraCoreInternal).toBe(false);
    }
    expect(typeof cameraCoreInternal.getCameraStores).toBe("function");
  });
});
