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

import type { GwenScopeMeta, IGwenScope } from "@gwenjs/schema";
import type { GwenRuntimeHooks } from "@gwenjs/schema";
import { ScopedHookable } from "../hooks/scoped-hookable.js";

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
  readonly engine: any; // typed as GwenEngine in consuming code
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

  private static _current: GwenScope | null = null;

  static current(): GwenScope | null {
    return GwenScope._current;
  }

  /** @internal */
  static _setCurrent(scope: GwenScope | null): void {
    GwenScope._current = scope;
  }

  constructor(
    engine: any,
    meta: Omit<GwenScopeMeta, "id"> & { id?: string },
    parent: GwenScope | null = null,
  ) {
    const id = meta.id ?? `${meta.type}#${++_scopeIdCounter}`;
    this.engine = engine;
    this.meta = Object.freeze({ ...meta, id } as GwenScopeMeta);
    this.parent = parent;
    this._hookable = new ScopedHookable(engine.hooks);
    if (parent) parent._children.push(this);
  }

  run<T>(fn: () => T): T {
    const prev = GwenScope._current;
    GwenScope._current = this;
    try {
      return fn();
    } finally {
      GwenScope._current = prev;
    }
  }

  hook<K extends keyof GwenRuntimeHooks>(name: K, fn: GwenRuntimeHooks[K]): () => void {
    this._hookCount++;
    const unsub = this._hookable.hook(name, fn);
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
