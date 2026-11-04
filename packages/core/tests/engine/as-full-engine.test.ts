import { describe, expect, it } from "vitest";
import { asFullEngine } from "../../src/internal";
import { createEngine } from "../../src/node";

describe("asFullEngine", () => {
  it("hands a plugin the same engine object typed as the full engine", async () => {
    const engine = await createEngine();
    try {
      let received: unknown;
      let narrowed: unknown;
      await engine.use({
        name: "as-full-engine-probe",
        setup(base) {
          received = base;
          narrowed = asFullEngine(base);
        },
      });
      expect(narrowed).toBe(received);
      expect(narrowed).toBeDefined();
      expect(Reflect.get(Object(narrowed), "frameCount")).toBe(engine.frameCount);
    } finally {
      await engine.stop();
    }
  });
});
