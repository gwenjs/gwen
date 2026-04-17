/**
 * TweenManager lifecycle — shutdown tests.
 *
 * Verifies that TweenManager unregisters its engine:tick hook on engine stop
 * and clears its cache so getTweenManager() creates a fresh instance on restart.
 */

import { describe, it, expect } from "vitest";
import { createEngine } from "../../src/engine/gwen-engine";
import { getTweenManager } from "../../src/tween/runtime/tween-manager";
import { TweenPlugin } from "../../src/tween/engine-plugin";
import type { GwenEngine } from "../../src/engine/gwen-engine";

describe("TweenManager — shutdown on engine stop", () => {
  it("tween stops advancing after engine.stop()", async () => {
    const engine = await createEngine();
    await engine.use(TweenPlugin());
    const manager = getTweenManager(engine as GwenEngine);

    const slot = manager.claim({ duration: 1.0 });
    slot!.play({ from: 0, to: 100 });

    // Advance normally before stop
    await engine.advance(0.1);
    const valueMid = slot!.value as number;
    expect(valueMid).toBeGreaterThan(0);

    await engine.stop();

    // Manually fire engine:tick — the hook should have been removed by _shutdown()
    engine.hooks.callHook("engine:tick", 0.1);

    // Value must not have changed — TweenManager no longer listens
    expect(slot!.value).toBe(valueMid);
  });

  it("engine.stop() calls disposeAll() — disposables registry is empty after stop", async () => {
    const engine = await createEngine();
    await engine.use(TweenPlugin());

    // Before stop: tween:manager disposable is registered
    expect(engine.disposables.size).toBeGreaterThan(0);

    await engine.stop();

    // After stop: disposeAll() was called — registry is empty
    expect(engine.disposables.size).toBe(0);
  });
});
