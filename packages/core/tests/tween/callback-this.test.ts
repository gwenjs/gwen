/**
 * `this` inside a `useSequence` completion callback.
 * The sequence calls its callbacks through an internal array. A `function` callback sees
 * `this === undefined`, never that array.
 */
import { describe, it, expect } from "vitest";
import { createEngine } from "../../src/node";
import { useSequence } from "../../src/tween/runtime/use-sequence";
import { TweenPlugin } from "../../src/tween/engine-plugin";

describe("useSequence onComplete: this", () => {
  it("runs the callback with this === undefined", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    try {
      await engine.use(TweenPlugin());
      const seen: unknown[] = [];
      engine.run(() => {
        const seq = useSequence([]);
        seq.onComplete(function (this: unknown) {
          seen.push(this);
        });
        seq.play();
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeUndefined();
    } finally {
      await engine.stop();
    }
  });
});
