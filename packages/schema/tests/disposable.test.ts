/**
 * @gwenjs/schema — GwenDisposable / DisposableRegistryBase structural tests.
 *
 * These tests verify that objects conforming to the interfaces behave as
 * documented. Since these are interface-only (no runtime class), tests work
 * with hand-crafted objects and focus on structural compatibility.
 */

import { describe, it, expect } from "vitest";
import type { GwenDisposable, DisposableRegistryBase } from "../src/disposable";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Minimal hand-crafted GwenDisposable for structural testing.
 * A real implementation lives in @gwenjs/core (createDisposable).
 */
function makeDisposable(fn: () => void): GwenDisposable {
  let disposed = false;
  return {
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      fn();
    },
    [Symbol.dispose]() {
      this.dispose();
    },
  };
}

// ─── GwenDisposable ───────────────────────────────────────────────────────────

describe("GwenDisposable (structural)", () => {
  it("starts with disposed = false", () => {
    const d = makeDisposable(() => {});
    expect(d.disposed).toBe(false);
  });

  it("dispose() sets disposed = true", () => {
    const d = makeDisposable(() => {});
    d.dispose();
    expect(d.disposed).toBe(true);
  });

  it("dispose() runs the callback once", () => {
    let calls = 0;
    const d = makeDisposable(() => calls++);
    d.dispose();
    d.dispose(); // second call — idempotent
    expect(calls).toBe(1);
  });

  it("Symbol.dispose() is equivalent to dispose()", () => {
    let calls = 0;
    const d = makeDisposable(() => calls++);
    d[Symbol.dispose]();
    d[Symbol.dispose](); // idempotent
    expect(calls).toBe(1);
    expect(d.disposed).toBe(true);
  });

  it("dispose() and Symbol.dispose() share idempotency state", () => {
    let calls = 0;
    const d = makeDisposable(() => calls++);
    d.dispose();
    d[Symbol.dispose]();
    expect(calls).toBe(1);
  });
});

// ─── DisposableRegistryBase ───────────────────────────────────────────────────

describe("DisposableRegistryBase (structural)", () => {
  /**
   * Minimal LIFO registry — mirrors the DisposableRegistry class in @gwenjs/core.
   */
  function makeRegistry(): DisposableRegistryBase {
    const stack: Array<{ name: string; d: GwenDisposable }> = [];
    return {
      add(name, d) {
        stack.push({ name, d });
      },
      disposeAll() {
        for (let i = stack.length - 1; i >= 0; i--) {
          stack[i].d.dispose();
        }
        stack.length = 0;
      },
      get size() {
        return stack.length;
      },
    };
  }

  it("size starts at 0", () => {
    const r = makeRegistry();
    expect(r.size).toBe(0);
  });

  it("size increments after add()", () => {
    const r = makeRegistry();
    r.add(
      "a",
      makeDisposable(() => {}),
    );
    r.add(
      "b",
      makeDisposable(() => {}),
    );
    expect(r.size).toBe(2);
  });

  it("disposeAll() calls all disposables", () => {
    const log: string[] = [];
    const r = makeRegistry();
    r.add(
      "first",
      makeDisposable(() => log.push("first")),
    );
    r.add(
      "second",
      makeDisposable(() => log.push("second")),
    );
    r.disposeAll();
    expect(log).toContain("first");
    expect(log).toContain("second");
  });

  it("disposeAll() calls in LIFO order", () => {
    const order: string[] = [];
    const r = makeRegistry();
    r.add(
      "a",
      makeDisposable(() => order.push("a")),
    );
    r.add(
      "b",
      makeDisposable(() => order.push("b")),
    );
    r.add(
      "c",
      makeDisposable(() => order.push("c")),
    );
    r.disposeAll();
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("disposeAll() resets size to 0", () => {
    const r = makeRegistry();
    r.add(
      "x",
      makeDisposable(() => {}),
    );
    r.disposeAll();
    expect(r.size).toBe(0);
  });

  it("disposeAll() on empty registry is safe", () => {
    const r = makeRegistry();
    expect(() => r.disposeAll()).not.toThrow();
  });
});
