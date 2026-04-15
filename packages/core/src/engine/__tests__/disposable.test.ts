/**
 * @gwenjs/core — createDisposable() + DisposableRegistry unit tests.
 */

import { describe, it, expect, vi } from "vitest";
import { createDisposable, DisposableRegistry } from "../../disposable.js";

// ─── createDisposable ─────────────────────────────────────────────────────────

describe("createDisposable()", () => {
  it("returns an object with disposed = false initially", () => {
    const d = createDisposable(() => {});
    expect(d.disposed).toBe(false);
  });

  it("calls the callback exactly once", () => {
    const fn = vi.fn();
    const d = createDisposable(fn);
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("sets disposed = true after dispose()", () => {
    const d = createDisposable(() => {});
    d.dispose();
    expect(d.disposed).toBe(true);
  });

  it("is idempotent — second dispose() is a no-op", () => {
    const fn = vi.fn();
    const d = createDisposable(fn);
    d.dispose();
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("Symbol.dispose() delegates to dispose()", () => {
    const fn = vi.fn();
    const d = createDisposable(fn);
    d[Symbol.dispose]();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(d.disposed).toBe(true);
  });

  it("Symbol.dispose() is also idempotent", () => {
    const fn = vi.fn();
    const d = createDisposable(fn);
    d[Symbol.dispose]();
    d[Symbol.dispose]();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("dispose() and Symbol.dispose() share idempotency state", () => {
    const fn = vi.fn();
    const d = createDisposable(fn);
    d.dispose();
    d[Symbol.dispose]();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("disposed getter returns live value", () => {
    const d = createDisposable(() => {});
    expect(d.disposed).toBe(false);
    d.dispose();
    expect(d.disposed).toBe(true);
  });
});

// ─── DisposableRegistry ───────────────────────────────────────────────────────

describe("DisposableRegistry", () => {
  it("size is 0 on creation", () => {
    const r = new DisposableRegistry();
    expect(r.size).toBe(0);
  });

  it("size increments after add()", () => {
    const r = new DisposableRegistry();
    r.add(
      "a",
      createDisposable(() => {}),
    );
    r.add(
      "b",
      createDisposable(() => {}),
    );
    expect(r.size).toBe(2);
  });

  it("disposeAll() calls all registered disposables", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const r = new DisposableRegistry();
    r.add("first", createDisposable(fn1));
    r.add("second", createDisposable(fn2));
    r.disposeAll();
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it("disposeAll() runs in LIFO order", () => {
    const order: string[] = [];
    const r = new DisposableRegistry();
    r.add(
      "a",
      createDisposable(() => order.push("a")),
    );
    r.add(
      "b",
      createDisposable(() => order.push("b")),
    );
    r.add(
      "c",
      createDisposable(() => order.push("c")),
    );
    r.disposeAll();
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("disposeAll() resets size to 0", () => {
    const r = new DisposableRegistry();
    r.add(
      "x",
      createDisposable(() => {}),
    );
    r.disposeAll();
    expect(r.size).toBe(0);
  });

  it("disposeAll() on an empty registry is safe", () => {
    const r = new DisposableRegistry();
    expect(() => r.disposeAll()).not.toThrow();
  });

  it("calling disposeAll() twice does not double-call callbacks", () => {
    const fn = vi.fn();
    const r = new DisposableRegistry();
    r.add("resource", createDisposable(fn));
    r.disposeAll();
    r.disposeAll(); // registry is empty — fn should not fire again
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("add() after disposeAll() works correctly", () => {
    const fn = vi.fn();
    const r = new DisposableRegistry();
    r.add(
      "first",
      createDisposable(() => {}),
    );
    r.disposeAll();
    r.add("second", createDisposable(fn));
    r.disposeAll();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("multiple registries are independent", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const r1 = new DisposableRegistry();
    const r2 = new DisposableRegistry();
    r1.add("a", createDisposable(fn1));
    r2.add("b", createDisposable(fn2));
    r1.disposeAll();
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).not.toHaveBeenCalled();
  });
});
