/**
 * createEngineLocal — registration, teardown and use after stop().
 * Real engines. The only fake engines are the non-engine argument rows.
 */
import { afterEach, describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { createEngine, createEngineLocal, type GwenEngine } from "../../src/index.js";
import { CoreErrorCodes } from "../../src/engine/engine-errors.js";
import { createDisposable } from "../../src/disposable.js";

const opened: GwenEngine[] = [];
async function open(): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: 16 });
  opened.push(engine);
  return engine;
}
afterEach(async () => {
  for (const engine of opened.splice(0)) {
    await engine.stop().catch(() => undefined);
  }
});

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error instanceof GwenError ? error.code : error;
  }
  return "no throw";
}

function counted() {
  let inits = 0;
  const disposed: number[] = [];
  const slot = createEngineLocal(
    () => ({ id: ++inits }),
    (value) => disposed.push(value.id),
  );
  return { slot, disposed, inits: () => inits };
}

function caught(fn: () => unknown): GwenError | unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return "no throw";
}

describe("createEngineLocal registration", () => {
  it("a non-engine throws CORE:INVALID_ENGINE every time and never runs init", () => {
    const { slot, inits } = counted();
    const rows: Array<[unknown, string]> = [
      [{}, "an object without disposables.add()"],
      [{ disposables: {} }, "an object without disposables.add()"],
      [null, "null"],
      [undefined, "undefined"],
      ["engine", "string"],
      [() => undefined, "an object without disposables.add()"],
    ];
    for (const [value, received] of rows) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const error = caught(() => slot.get(value as GwenEngine));
        expect(error).toBeInstanceOf(GwenError);
        expect((error as GwenError).code).toBe("CORE:INVALID_ENGINE");
        expect((error as GwenError).message).toContain(
          `[createEngineLocal().get()] Expected a GWEN engine, received ${received}.`,
        );
        expect((error as GwenError).hint).toBe(
          __GWEN_DEV__
            ? "Pass the engine from useEngine(), plugin setup() or createEngine()."
            : undefined,
        );
      }
      expect(slot.peek(value as GwenEngine)).toBeUndefined();
    }
    expect(inits()).toBe(0);
  });

  it("a registry whose add throws leaves no entry, so the next get fails again", () => {
    const { slot, inits } = counted();
    const broken: unknown = {
      disposables: {
        add() {
          throw new Error("add failed");
        },
      },
    };
    expect(() => slot.get(broken as GwenEngine)).toThrow("add failed");
    expect(() => slot.get(broken as GwenEngine)).toThrow("add failed");
    expect(slot.peek(broken as GwenEngine)).toBeUndefined();
    expect(inits()).toBe(2);
  });

  it("an object with disposables.add still holds one value", () => {
    const { slot } = counted();
    const duck: unknown = { disposables: { add() {} } };
    const first = slot.get(duck as GwenEngine);
    expect(slot.get(duck as GwenEngine)).toBe(first);
  });

  it("an init that throws stores nothing and the next get retries", async () => {
    const engine = await open();
    let calls = 0;
    const slot = createEngineLocal(() => {
      calls += 1;
      if (calls === 1) throw new Error("init failed");
      return calls;
    });
    const base = engine.disposables.size;
    expect(() => slot.get(engine)).toThrow("init failed");
    expect(slot.peek(engine)).toBeUndefined();
    expect(engine.disposables.size - base).toBe(0);
    expect(slot.get(engine)).toBe(2);
    expect(engine.disposables.size - base).toBe(1);
  });
});

describe("createEngineLocal teardown", () => {
  it("zero, one and two values: stop() disposes each once", async () => {
    const none = counted();
    const zero = await open();
    await zero.stop();
    expect(none.disposed).toEqual([]);

    const one = await open();
    const a = counted();
    const b = counted();
    a.slot.get(one);
    b.slot.get(one);
    await one.stop();
    await one.stop();
    expect(a.disposed).toEqual([1]);
    expect(b.disposed).toEqual([1]);
  });

  it("two locals on one engine dispose in reverse creation order", async () => {
    const engine = await open();
    const order: string[] = [];
    const first = createEngineLocal(
      () => "first",
      (v) => order.push(v),
    );
    const second = createEngineLocal(
      () => "second",
      (v) => order.push(v),
    );
    first.get(engine);
    second.get(engine);
    await engine.stop();
    expect(order).toEqual(["second", "first"]);
  });

  it("two engines: stopping one leaves the other's value", async () => {
    const a = await open();
    const b = await open();
    const { slot, disposed } = counted();
    slot.get(a);
    const kept = slot.get(b);
    await a.stop();
    expect(disposed).toEqual([1]);
    expect(slot.get(b)).toBe(kept);
  });

  it("the setup proxy and the engine share one value, dispose gets the engine", async () => {
    const engine = await open();
    let seen: GwenEngine | undefined;
    const slot = createEngineLocal(
      () => ({ n: 1 }),
      (_v, e) => {
        seen = e;
      },
    );
    let viaProxy: unknown;
    await engine.use({
      name: "el-proxy",
      setup(proxy) {
        viaProxy = slot.get(proxy as GwenEngine);
      },
    });
    expect(slot.get(engine)).toBe(viaProxy);
    await engine.stop();
    expect(seen).toBe(engine);
  });

  it("a throwing dispose still clears the entry", async () => {
    const engine = await open();
    const slot = createEngineLocal(
      () => ({ n: 1 }),
      () => {
        throw new Error("dispose failed");
      },
    );
    slot.get(engine);
    await expect(engine.stop()).rejects.toThrow("dispose failed");
    expect(slot.peek(engine)).toBeUndefined();
  });

  it("get in an engine:stop hook creates a value that stop() disposes", async () => {
    const engine = await open();
    const { slot, disposed } = counted();
    engine.hooks.hook("engine:stop", () => {
      slot.get(engine);
    });
    await engine.stop();
    expect(disposed).toEqual([1]);
    expect(engine.disposables.size).toBe(0);
  });

  it("a disposer that runs before the value's own disposer still reads it", async () => {
    const engine = await open();
    const { slot } = counted();
    const created = slot.get(engine);
    let read: unknown;
    let peeked: unknown;
    engine.disposables.add(
      "reader",
      createDisposable(() => {
        read = slot.get(engine);
        peeked = slot.peek(engine);
      }),
    );
    await engine.stop();
    expect(read).toBe(created);
    expect(peeked).toBe(created);
  });
});

describe("createEngineLocal after stop()", () => {
  it("get after stop() throws CORE:ENGINE_DISPOSED and registers nothing", async () => {
    const engine = await open();
    const { slot, disposed, inits } = counted();
    slot.get(engine);
    await engine.stop();
    let caught: unknown;
    try {
      slot.get(engine);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenError);
    expect((caught as GwenError).code).toBe(CoreErrorCodes.ENGINE_DISPOSED);
    expect((caught as GwenError).message).toContain(
      "[createEngineLocal().get()] Cannot create a per-engine value after engine.stop().",
    );
    expect(engine.disposables.size).toBe(0);
    expect(inits()).toBe(1);
    expect(disposed).toEqual([1]);
    expect(slot.peek(engine)).toBeUndefined();
  });

  it("use() inside engine.run() after stop() throws CORE:ENGINE_DISPOSED", async () => {
    const engine = await open();
    const { slot } = counted();
    await engine.stop();
    expect(codeOf(() => engine.run(() => slot.use()))).toBe(CoreErrorCodes.ENGINE_DISPOSED);
  });

  it("get from a disposer during stop() throws CORE:ENGINE_DISPOSED", async () => {
    const engine = await open();
    const { slot } = counted();
    let code: unknown;
    engine.disposables.add(
      "late-reader",
      createDisposable(() => {
        code = codeOf(() => slot.get(engine));
      }),
    );
    slot.get(engine);
    await engine.stop();
    expect(code).toBe(CoreErrorCodes.ENGINE_DISPOSED);
    expect(slot.peek(engine)).toBeUndefined();
  });

  it("get after stop() from faulted throws CORE:ENGINE_DISPOSED", async () => {
    const engine = await open();
    engine.hooks.hook("engine:start", () => {
      throw new Error("start failed");
    });
    await expect(engine.start()).rejects.toThrow("start failed");
    await engine.stop();
    expect(engine.state).toBe("faulted");
    const { slot } = counted();
    expect(codeOf(() => slot.get(engine))).toBe(CoreErrorCodes.ENGINE_DISPOSED);
    expect(engine.disposables.size).toBe(0);
  });
});

describe("createEngineLocal re-entrant init", () => {
  it("an init that reads its own local throws CORE:ENGINE_LOCAL_REENTRANT at once", async () => {
    const engine = await open();
    let calls = 0;
    const slot: { get(e: GwenEngine): number } = createEngineLocal((e) => {
      calls += 1;
      return slot.get(e);
    });
    const base = engine.disposables.size;
    const error = caught(() => slot.get(engine));
    expect(error).toBeInstanceOf(GwenError);
    expect((error as GwenError).code).toBe("CORE:ENGINE_LOCAL_REENTRANT");
    expect((error as GwenError).message).toContain(
      "[createEngineLocal().get()] init() called get() for the engine it is creating a value for.",
    );
    expect(calls).toBe(1);
    expect(engine.disposables.size - base).toBe(0);
    // The marker is cleared in finally: the next get runs init again.
    caught(() => slot.get(engine));
    expect(calls).toBe(2);
  });

  it("an init that catches the re-entry stores one value and one disposable", async () => {
    const engine = await open();
    let n = 0;
    let inner: unknown;
    const slot: { get(e: GwenEngine): { id: number } } = createEngineLocal((e) => {
      const id = ++n;
      if (id === 1) inner = codeOf(() => slot.get(e));
      return { id };
    });
    const base = engine.disposables.size;
    expect(slot.get(engine)).toEqual({ id: 1 });
    expect(inner).toBe("CORE:ENGINE_LOCAL_REENTRANT");
    expect(engine.disposables.size - base).toBe(1);
    expect(slot.get(engine)).toEqual({ id: 1 });
  });

  it("init for engine A may read the same local for engine B", async () => {
    const a = await open();
    const b = await open();
    const slot: { get(e: GwenEngine): string } = createEngineLocal((e) =>
      e === a ? `A+${slot.get(b)}` : "B",
    );
    expect(slot.get(a)).toBe("A+B");
    expect(slot.get(b)).toBe("B");
  });
});
