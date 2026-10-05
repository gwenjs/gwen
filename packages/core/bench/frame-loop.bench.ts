import { bench } from "vitest";

import { measureFrameLoop } from "./frame-loop-scene.js";

bench("light reference scene", () => measureFrameLoop({ variant: "light", copyFloor: true }), {
  iterations: 1,
  warmupIterations: 0,
  warmupTime: 0,
  time: 0,
});
