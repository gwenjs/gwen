/**
 * Per-target isolation flags and the registration-time handler guard.
 *
 * The guard is allocated once per subscription. A successful sync call does not
 * allocate a closure or a promise.
 */

import type { GwenErrorTarget, GwenScopeMeta, PluginErrorContext } from "@gwenjs/schema";

interface IsolationState {
  order: GwenErrorTarget[];
  ids: Set<string>;
}

interface NotedFailure {
  target: GwenErrorTarget;
  hook: string;
  error: unknown;
}

const states = new WeakMap<object, IsolationState>();

let setupTarget: GwenErrorTarget | null = null;
let noted: NotedFailure | null = null;

function stateFor(engine: object): IsolationState {
  let state = states.get(engine);
  if (!state) {
    state = { order: [], ids: new Set() };
    states.set(engine, state);
  }
  return state;
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function beginPluginSetup(plugin: { name: string }): void {
  setupTarget = { kind: "plugin", id: plugin.name, name: plugin.name };
}

export function endPluginSetup(): void {
  setupTarget = null;
}

export function currentPluginSetupTarget(): GwenErrorTarget | null {
  return setupTarget;
}

export function targetFromScopeMeta(meta: GwenScopeMeta): GwenErrorTarget {
  const target: GwenErrorTarget = {
    kind: meta.type,
    id: meta.id,
    name: meta.name && meta.name.length > 0 ? meta.name : meta.id,
  };
  if (meta.entityId !== undefined) target.entityId = meta.entityId;
  return target;
}

export function phaseForHook(hook: string): PluginErrorContext["phase"] {
  switch (hook) {
    case "engine:before-update":
      return "onBeforeUpdate";
    case "engine:update":
      return "onUpdate";
    case "engine:after-update":
      return "onAfterUpdate";
    case "engine:render":
      return "onRender";
    case "setup":
      return "setup";
    case "teardown":
      return "teardown";
    default:
      return "hook";
  }
}

export function isIsolated(engine: object, id: string): boolean {
  return states.get(engine)?.ids.has(id) ?? false;
}

/** @returns true when this call newly isolates the target. */
export function isolateTarget(engine: object, target: GwenErrorTarget): boolean {
  const state = stateFor(engine);
  if (state.ids.has(target.id)) return false;
  state.ids.add(target.id);
  state.order.push(target);
  return true;
}

export function forgetTarget(engine: object, id: string): boolean {
  const state = states.get(engine);
  if (!state?.ids.has(id)) return false;
  state.ids.delete(id);
  const index = state.order.findIndex((target) => target.id === id);
  if (index !== -1) state.order.splice(index, 1);
  return true;
}

export function listIsolated(engine: object): readonly GwenErrorTarget[] {
  return states.get(engine)?.order ?? [];
}

export function clearIsolated(engine: object): void {
  states.delete(engine);
}

export function noteHandlerFailure(target: GwenErrorTarget, hook: string, error: unknown): void {
  noted = { target, hook, error };
}

function thrownCause(error: object): unknown {
  if (!("cause" in error)) return undefined;
  return (error as { cause?: unknown }).cause;
}

export function consumeHandlerFailure(
  error: unknown,
): { target: GwenErrorTarget; hook: string } | null {
  const found = noted;
  noted = null;
  if (!found) return null;
  if (found.error === error) return found;
  if (error instanceof Error && thrownCause(error) === found.error) return found;
  return null;
}

export function guardHandler(
  fn: (...args: unknown[]) => unknown,
  target: GwenErrorTarget,
  hook: string,
  isSkipped: () => boolean,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    if (isSkipped()) return undefined;
    try {
      const result = fn(...args);
      if (!isThenable(result)) return result;
      return result.then(undefined, (error: unknown) => {
        noteHandlerFailure(target, hook, error);
        throw error;
      });
    } catch (error) {
      noteHandlerFailure(target, hook, error);
      throw error;
    }
  };
}
