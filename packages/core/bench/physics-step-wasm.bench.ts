import { bench, describe } from "vitest";

import { buildScene } from "./fixtures/physics-step-scene";

describe("physics step (real WASM)", () => {
  bench("physics2d N=500", () => {
    void buildScene("physics2d", 500);
  });
  bench("physics2d N=2000", () => {
    void buildScene("physics2d", 2000);
  });
  bench("physics3d N=500", () => {
    void buildScene("physics3d", 500);
  });
  bench("physics3d N=2000", () => {
    void buildScene("physics3d", 2000);
  });
});
