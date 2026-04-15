/**
 * TweenManager lifecycle — shutdown tests.
 *
 * Verifies that TweenManager unregisters its engine:tick hook on engine stop
 * and clears its cache so getTweenManager() creates a fresh instance on restart.
 */

import { describe, it, expect } from "vitest";
import { createEngine } from "../../src/engine/gwen-engine";
import { getTweenManager, TweenManager } from "../../src/tween/tween-manager";
import type { GwenEngine } from "../../src/engine/gwen-engine";

describe("TweenManager — shutdown on engine stop", () => {
  it("tween stops advancing after engine.stop()", async () => {
    const engine = await createEngine();
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

  it("getTweenManager returns a fresh instance after engine.stop()", async () => {
    const engine = await createEngine();
    const manager1 = getTweenManager(engine as GwenEngine);

    await engine.stop();

    // Cache was cleared by _shutdown() — new instance must be created
    const manager2 = getTweenManager(engine as GwenEngine);
    expect(manager2).not.toBe(manager1);
    expect(manager2).toBeInstanceOf(TweenManager);
  });
});
