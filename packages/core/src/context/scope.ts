/**
 * @file Unified execution context for GWEN runtime.
 *
 * Every GWEN runtime object (engine, plugin, scene, actor, system) owns a
 * `GwenScope` instance. A scope encapsulates:
 * - A `ScopedHookable` for subscribing to runtime hooks with automatic pause/resume
 * - LIFO cleanup callbacks registered via `onCleanup()`
 * - A parent-child hierarchy — disposing a parent automatically disposes all children first
 *
 * @internal Framework use only. Plugin authors use `useCurrentScope()` from `@gwenjs/kit`.
 *
 * @module
 */

import type { GwenEngineBase, GwenRuntimeHooks, GwenScopeMeta, IGwenScope } from "@gwenjs/schema";
import { getCurrentScope, _setCurrentScope } from "@gwenjs/kit";
import { ScopedHookable } from "../hooks/scoped-hookable.js";
import type { GwenEngine } from "../engine/engine-types.js";
import { enterSystemDepth, leaveSystemDepth } from "../engine/engine-internals.js";
import {
  forgetTarget,
  guardHandler,
  isThenable,
  targetFromScopeMeta,
} from "../engine/error-isolation.js";

let _scopeIdCounter = 0;

/**
 * Unified execution context for every GWEN runtime object (engine, plugin, scene, actor, system).
 *
 * A scope encapsulates:
 * - A `ScopedHookable` for subscribing to runtime hooks with automatic pause/resume
 * - LIFO cleanup callbacks registered via `onCleanup()`
 * - A parent-child hierarchy — disposing a parent automatically disposes all children first
 *
 * @internal Framework use only. Plugin authors use `useCurrentScope()` from `@gwenjs/kit`.
 */
export class GwenScope implements IGwenScope {
  readonly meta: GwenScopeMeta;
  readonly engine: GwenEngineBase;
  readonly parent: GwenScope | null;

  private _hookable: ScopedHookable;
  private _cleanups: (() => void)[] = [];
  private _children: GwenScope[] = [];
  private _disposed = false;
  private _hookCount = 0;

  get hookCount(): number {
    return this._hookCount;
  }

  get childCount(): number {
    return this._children.length;
  }

  get cleanupCount(): number {
    return this._cleanups.length;
  }

  get paused(): boolean {
    return this._hookable.paused;
  }

  static current(): GwenScope | null {
    const slot = getCurrentScope();
    if (!(slot instanceof GwenScope)) return null;
    return slot;
  }

  /** @internal */
  static _setCurrent(scope: GwenScope | null): void {
    _setCurrentScope(scope);
  }

  constructor(
    engine: GwenEngine,
    meta: Omit<GwenScopeMeta, "id"> & { id?: string },
    parent: GwenScope | null = null,
    customHookable?: ScopedHookable,
  ) {
    const id = meta.id ?? `${meta.type}#${++_scopeIdCounter}`;
    this.engine = engine;
    this.meta = Object.freeze({ ...meta, id } as GwenScopeMeta);
    this.parent = parent;
    this._hookable = customHookable || new ScopedHookable(engine.hooks);
    this._hookable.setIsolationForget(() => {
      forgetTarget(engine, this.meta.id);
    });
    if (parent) parent._children.push(this);
  }

  run<T>(fn: () => T): T {
    const prev = getCurrentScope();
    _setCurrentScope(this);
    try {
      return fn();
    } finally {
      _setCurrentScope(prev);
    }
  }

  hook<K extends keyof GwenRuntimeHooks>(name: K, fn: GwenRuntimeHooks[K]): () => void {
    this._hookCount++;
    const target = targetFromScopeMeta(this.meta);
    const guarded = guardHandler(
      fn as (...args: unknown[]) => unknown,
      target,
      String(name),
      this.engine,
    );
    const scopeEngine: unknown = this.engine;
    const tracked =
      this.meta.type === "system" && isScopeEngine(scopeEngine)
        ? withSystemDepth(scopeEngine, guarded)
        : guarded;
    const unsub = this._hookable.hook(name, tracked as GwenRuntimeHooks[K]);
    return () => {
      unsub();
      this._hookCount--;
    };
  }

  onCleanup(fn: () => void): void {
    this._cleanups.push(fn);
  }

  pause(): void {
    this._hookable.pause();
  }

  resume(): void {
    this._hookable.resume();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // Dispose children first (FIFO order)
    for (let i = this._children.length - 1; i >= 0; i--) {
      this._children[i]?.dispose();
    }
    this._children = [];

    // Dispose the hookable (unregister all handlers)
    this._hookable.dispose();

    // Run cleanups in LIFO order
    for (let i = this._cleanups.length - 1; i >= 0; i--) {
      this._cleanups[i]?.();
    }
    this._cleanups = [];

    // Unregister from parent
    if (this.parent) {
      const idx = this.parent._children.indexOf(this);
      if (idx !== -1) this.parent._children.splice(idx, 1);
    }
  }
}

/** `engine` is `GwenEngineBase` and has no frame counter. System hooks need one. */
function isScopeEngine(value: unknown): value is GwenEngine {
  if (typeof value !== "object" || value === null) return false;
  const frameCount: unknown = Reflect.get(value, "frameCount");
  const errors: unknown = Reflect.get(value, "errors");
  if (typeof frameCount !== "number") return false;
  if (typeof errors !== "object" || errors === null) return false;
  return typeof Reflect.get(errors, "emit") === "function";
}

type GuardedHook = (a: unknown, b: unknown, c: unknown, d: unknown) => unknown;

/**
 * System hooks only. Depth stays up until a returned thenable settles.
 * A sync hook drops it before returning, including when the guard swallows a throw.
 */
function withSystemDepth(engine: GwenEngine, handler: GuardedHook): GuardedHook {
  return function tracked(a: unknown, b: unknown, c: unknown, d: unknown): unknown {
    enterSystemDepth(engine);
    try {
      const result =
        arguments.length > 4
          ? Function.prototype.apply.call(handler, undefined, arguments)
          : handler(a, b, c, d);
      if (!isThenable(result)) {
        leaveSystemDepth(engine);
        return result;
      }
      return settleSystemDepth(engine, result);
    } catch (error: unknown) {
      leaveSystemDepth(engine);
      throw error;
    }
  };
}

function settleSystemDepth(engine: GwenEngine, result: PromiseLike<unknown>): PromiseLike<unknown> {
  let left = false;
  const leave = (): void => {
    if (left) return;
    left = true;
    leaveSystemDepth(engine);
  };
  return result.then(
    (value: unknown) => {
      leave();
      return value;
    },
    (error: unknown) => {
      leave();
      throw error;
    },
  );
}
