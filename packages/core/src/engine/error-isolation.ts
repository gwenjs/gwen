/**
 * Per-target isolation flags and the registration-time handler guard.
 *
 * The guard is allocated once per subscription. A successful sync call does not
 * allocate a closure or a promise. An identified throw is reported and does not
 * leave the guard, so later handlers of the same hook still run.
 */

import type { GwenErrorTarget, GwenScopeMeta, PluginErrorContext } from "@gwenjs/schema";

interface IsolationState {
  order: GwenErrorTarget[];
  ids: Set<string>;
}

type FailureReporter = (error: unknown, target: GwenErrorTarget, hook: string) => void;

const states = new WeakMap<object, IsolationState>();
const reporters = new WeakMap<object, FailureReporter>();
const NO_ISOLATED: readonly GwenErrorTarget[] = [];

let setupTarget: GwenErrorTarget | null = null;

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

/** @returns The previous target. Pass it to {@link endPluginSetup}. */
export function beginPluginSetup(plugin: { name: string }): GwenErrorTarget | null {
  const previous = setupTarget;
  setupTarget = { kind: "plugin", id: plugin.name, name: plugin.name };
  return previous;
}

export function endPluginSetup(previous: GwenErrorTarget | null): void {
  setupTarget = previous;
}

export function bindFailureReporter(engine: object, report: FailureReporter): void {
  reporters.set(engine, report);
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
  const order = states.get(engine)?.order;
  if (!order || order.length === 0) return NO_ISOLATED;
  return order.slice();
}

export function clearIsolated(engine: object): void {
  states.delete(engine);
}

function reportFailure(
  engine: object,
  error: unknown,
  target: GwenErrorTarget,
  hook: string,
): void {
  reporters.get(engine)?.(error, target, hook);
}

function forward(
  fn: (...args: unknown[]) => unknown,
  a: unknown,
  b: unknown,
  c: unknown,
  d: unknown,
): unknown {
  if (d !== undefined) return fn(a, b, c, d);
  if (c !== undefined) return fn(a, b, c);
  if (b !== undefined) return fn(a, b);
  if (a !== undefined) return fn(a);
  return fn();
}

export function guardHandler(
  fn: (...args: unknown[]) => unknown,
  target: GwenErrorTarget,
  hook: string,
  engine: object,
): (a: unknown, b: unknown, c: unknown, d: unknown) => unknown {
  return function guarded(a: unknown, b: unknown, c: unknown, d: unknown): unknown {
    if (isIsolated(engine, target.id)) return undefined;
    try {
      const result = forward(fn, a, b, c, d);
      if (!isThenable(result)) return result;
      return result.then(undefined, (error: unknown) => {
        reportFailure(engine, error, target, hook);
        return undefined;
      });
    } catch (error) {
      reportFailure(engine, error, target, hook);
      return undefined;
    }
  };
}
