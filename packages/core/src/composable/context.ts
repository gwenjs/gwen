/**
 * @file defineComposable — composable context declaration and validation.
 *
 * Provides a public primitive that wraps a composable function and asserts
 * (in dev) that it is called from the correct engine context.
 *
 * Context hierarchy:
 *   engine ⊆ system ⊆ actor   (actor implies system implies engine)
 *   engine ⊆ scene
 *
 * @module
 */

import { ContextSlot } from "../engine/context-slot.js";
import { GwenContextError } from "../engine/context.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The four composable execution contexts in GWEN.
 *
 * - `'engine'` — any active engine context (plugin setup, `engine.run()`, any `define*` factory)
 * - `'system'` — inside a `defineSystem()` factory or `defineActor()` factory
 * - `'actor'`  — inside a `defineActor()` factory only
 * - `'scene'`  — inside a `defineScene()` factory only
 */
export type ComposableContext = "engine" | "system" | "actor" | "scene";

// ─── Module-level context slot ────────────────────────────────────────────────

/**
 * Active composable context. Set by each `define*` via `_withComposableContext`.
 * `null` when called outside any GWEN context.
 * @internal
 */
const _ctx = new ContextSlot<ComposableContext>();

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Run `fn` with the composable context slot set to `type`.
 * Restores the previous value on return (safe for re-entrant / nested calls).
 * Called once per `define*` boundary — one line added to each factory.
 * @internal
 */
export function _withComposableContext<R>(type: ComposableContext, fn: () => R): R {
  return _ctx.run(type, fn);
}

/**
 * Returns true when `current` satisfies the `required` context.
 *
 * Hierarchy: actor ⊇ system ⊇ engine, scene ⊇ engine.
 */
function isCompatible(required: ComposableContext, current: ComposableContext | null): boolean {
  if (current === null) return false;
  switch (required) {
    case "engine":
      return true; // any active context satisfies engine requirement
    case "system":
      return current === "system" || current === "actor";
    case "actor":
      return current === "actor";
    case "scene":
      return current === "scene";
  }
}

/** Human-readable hints for each required context. */
const CONTEXT_HINTS: Record<ComposableContext, string> = {
  engine:
    "Call it inside plugin setup(), engine.run(), defineSystem(), defineActor(), or defineScene().",
  system: "Call it inside a defineSystem() or defineActor() factory.",
  actor: "Call it inside a defineActor() factory.",
  scene: "Call it inside a defineScene() factory.",
};

function buildContextError(
  name: string,
  required: ComposableContext,
  current: ComposableContext | null,
): string {
  const from = current ? `'${current}'` : "no context";
  return (
    `[GWEN] ${name || "composable"}() requires '${required}' context but was called from ${from}.\n` +
    CONTEXT_HINTS[required]
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Declares the required execution context for a composable and wraps it with
 * a dev-mode assertion.
 *
 * In `DEV` mode, calling the returned function outside the declared context
 * throws `GwenContextError` with code `'WRONG_CONTEXT'` and a helpful message.
 * In production (`PROD`), the wrapper is a transparent pass-through — zero overhead.
 *
 * @param required - The minimum context required to call this composable.
 * @param fn       - The composable implementation.
 * @returns A wrapped function with identical signature that validates the context.
 *
 * @example
 * ```ts
 * // useHealth.ts — actor-only composable
 * export const useHealth = defineComposable('actor', (maxHp: number) => {
 *   const health = useComponent(Health)
 *   onStart(() => health.$set({ hp: maxHp }))
 *   return { takeDamage: (n: number) => health.$set({ hp: health.hp - n }) }
 * })
 * ```
 */
export function defineComposable<TArgs extends unknown[], TReturn>(
  required: ComposableContext,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  return (...args: TArgs): TReturn => {
    if (import.meta.env.DEV) {
      const current = _ctx.get();
      if (!isCompatible(required, current)) {
        throw new GwenContextError(buildContextError(fn.name, required, current), "WRONG_CONTEXT");
      }
    }
    return fn(...args);
  };
}
