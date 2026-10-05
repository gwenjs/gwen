import { describe, it, expect } from "vitest";
import { createEngine } from "../../src";
import { engineContext } from "../../src/internal";
import { defineScene } from "../../src/scene/runtime/define-scene";
import { onEnter, onExit } from "../../src/scene/runtime/scene-context";
import { defineSceneRouter } from "../../src/router/defines/define-scene-router";
import { useSceneRouter } from "../../src/router/uses/use-scene-router";

function wait(ms = 0) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("direct onEnter call — engine context set and unset", () => {
  it("context is available after await when onEnter is called with set/unset", async () => {
    let capturedEngine: unknown;

    const SceneA = defineScene("bp_a", () => {
      onEnter(async () => {
        await wait();
        capturedEngine = engineContext.tryUse();
      });
    });

    const engine = await createEngine({ maxEntities: 100 });
    const def = (
      SceneA as unknown as (r: { register: () => void }) => { onEnter?: () => Promise<void> }
    )({ register: () => {} });

    engineContext.set(engine, true);
    try {
      if (def.onEnter) await def.onEnter();
    } finally {
      engineContext.unset();
    }

    expect(capturedEngine).toBe(engine);
  });

  it("context is falsy after direct onEnter completes (no leak)", async () => {
    const SceneA = defineScene("bp_leak", () => {
      onEnter(async () => {
        await wait();
      });
    });

    const engine = await createEngine({ maxEntities: 100 });
    const def = (
      SceneA as unknown as (r: { register: () => void }) => { onEnter?: () => Promise<void> }
    )({ register: () => {} });

    engineContext.set(engine, true);
    try {
      if (def.onEnter) await def.onEnter();
    } finally {
      engineContext.unset();
    }

    expect(engineContext.tryUse()).toBeFalsy();
  });
});

describe("useSceneRouter creation does not activate the initial scene", () => {
  it("creating the router does not run the initial onEnter", async () => {
    let capturedEngine: unknown;

    const SceneA = defineScene("init_a", () => {
      onEnter(async () => {
        await wait();
        capturedEngine = engineContext.tryUse();
      });
    });

    const Router = defineSceneRouter({
      initial: "init_a",
      routes: {
        init_a: { scene: SceneA, on: {} },
      },
    });

    const engine = await createEngine({ maxEntities: 100 });
    engineContext.set(engine, true);
    try {
      useSceneRouter(Router);
      await wait(10);
    } finally {
      engineContext.unset();
    }

    expect(capturedEngine).toBeUndefined();
  });
});

describe("async onEnter — engine context propagation", () => {
  it("useEngine() works after await in onEnter", async () => {
    let capturedEngine: unknown;

    const SceneA = defineScene("a", () => {});
    const SceneB = defineScene("b", () => {
      onEnter(async () => {
        await wait();
        capturedEngine = engineContext.tryUse();
      });
    });

    const Router = defineSceneRouter({
      initial: "a",
      routes: {
        a: { scene: SceneA, on: { GO: "b" } },
        b: { scene: SceneB, on: {} },
      },
    });

    const engine = await createEngine({ maxEntities: 100 });
    // Use callAsync (not engine.run) — run() uses synchronous call() which
    // restores context immediately when the async fn yields, losing context
    // before callAsync inside send() can propagate it across the await.
    await engineContext.callAsync(engine, async () => {
      const nav = useSceneRouter(Router);
      await nav.send("GO");
    });

    expect(capturedEngine).toBe(engine);
  });

  it("useEngine() works after multiple awaits in onEnter", async () => {
    const captured: unknown[] = [];

    const SceneA = defineScene("ma", () => {});
    const SceneB = defineScene("mb", () => {
      onEnter(async () => {
        await wait();
        captured.push(engineContext.tryUse());
        await wait();
        captured.push(engineContext.tryUse());
      });
    });

    const Router = defineSceneRouter({
      initial: "ma",
      routes: {
        ma: { scene: SceneA, on: { GO: "mb" } },
        mb: { scene: SceneB, on: {} },
      },
    });

    const engine = await createEngine({ maxEntities: 100 });
    await engineContext.callAsync(engine, async () => {
      await useSceneRouter(Router).send("GO");
    });

    expect(captured).toHaveLength(2);
    expect(captured[0]).toBe(engine);
    expect(captured[1]).toBe(engine);
  });

  it("useEngine() works after await in onExit", async () => {
    let capturedEngine: unknown;

    const SceneA = defineScene("ea", () => {
      onExit(async () => {
        await wait();
        capturedEngine = engineContext.tryUse();
      });
    });
    const SceneB = defineScene("eb", () => {});

    const Router = defineSceneRouter({
      initial: "ea",
      routes: {
        ea: { scene: SceneA, on: { GO: "eb" } },
        eb: { scene: SceneB, on: {} },
      },
    });

    const engine = await createEngine({ maxEntities: 100 });
    await engineContext.callAsync(engine, async () => {
      await useSceneRouter(Router).send("GO");
    });

    expect(capturedEngine).toBe(engine);
  });

  it("context is falsy after onEnter completes (no leak)", async () => {
    const SceneA = defineScene("la", () => {});
    const SceneB = defineScene("lb", () => {
      onEnter(async () => {
        await wait();
      });
    });

    const Router = defineSceneRouter({
      initial: "la",
      routes: {
        la: { scene: SceneA, on: { GO: "lb" } },
        lb: { scene: SceneB, on: {} },
      },
    });

    const engine = await createEngine({ maxEntities: 100 });
    await engineContext.callAsync(engine, async () => {
      await useSceneRouter(Router).send("GO");
    });

    // After callAsync completes, context must be cleared
    expect(engineContext.tryUse()).toBeFalsy();
  });

  it("two sequential transitions do not cross-contaminate context", async () => {
    const seen: unknown[] = [];

    const SceneA = defineScene("ca", () => {});
    const SceneB = defineScene("cb", () => {
      onEnter(async () => {
        await wait();
        seen.push(engineContext.tryUse());
      });
    });
    const SceneC = defineScene("cc", () => {
      onEnter(async () => {
        await wait();
        seen.push(engineContext.tryUse());
      });
    });

    const Router = defineSceneRouter({
      initial: "ca",
      routes: {
        ca: { scene: SceneA, on: { TO_B: "cb" } },
        cb: { scene: SceneB, on: { TO_C: "cc" } },
        cc: { scene: SceneC, on: {} },
      },
    });

    const engine = await createEngine({ maxEntities: 100 });
    await engineContext.callAsync(engine, async () => {
      const nav = useSceneRouter(Router);
      await nav.send("TO_B");
      await nav.send("TO_C");
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(engine);
    expect(seen[1]).toBe(engine);
  });
});
