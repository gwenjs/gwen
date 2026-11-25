/**
 * `gwen:hot-path-warn` warns when `useQuery`, `useService` or `useWasmModule` is called
 * inside the function given to `onBeforeUpdate`, `onUpdate`, `onAfterUpdate` or `onRender`.
 * That function runs every frame, so the lookup runs every frame. The unit never edits
 * and never raises: it returns no edit and logs `VITE:HOT_PATH_LOOKUP` once per call site.
 * Names are the resolved GWEN names (`ctx.resolveCallee`), not local aliases.
 * A `defineSystem` or `defineActor` call inside the callback is a barrier: its own
 * factory is a setup, so a lookup there is not per frame.
 * Another function (`forEach(() => ...)`) does not change the answer: the nearest
 * enclosing frame callback or barrier decides.
 * A lookup in the arguments of the frame call itself runs once, at setup.
 * `// @gwen-no-optimize` silences a module, a statement or a frame call (`ctx.isOptedOut`).
 */

import type { ArrowFunctionExpression, Function } from "oxc-parser";
import { ViteErrorCodes } from "../error-codes.js";
import { walk, type Node, type WalkerThisContextEnter } from "../oxc/index.js";
import type { GwenCallee, GwenSourceTransform } from "../pipeline/types.js";

/** The callee that decides the frame callback. `null` marks a setup barrier. */
type Scope = string | null;

function isFrameCallback(callee: GwenCallee | null): boolean {
  return (
    callee === "onBeforeUpdate" ||
    callee === "onUpdate" ||
    callee === "onAfterUpdate" ||
    callee === "onRender"
  );
}

function isLookup(callee: GwenCallee | null): boolean {
  return callee === "useQuery" || callee === "useService" || callee === "useWasmModule";
}

function isBarrier(callee: GwenCallee | null): boolean {
  return callee === "defineSystem" || callee === "defineActor";
}

function isFunctionNode(node: { type: string }): node is ArrowFunctionExpression | Function {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

/** A statement or a declaration: the places where a directive is written. */
function isStatementLevel(node: { type: string }): boolean {
  return node.type.endsWith("Statement") || node.type.endsWith("Declaration");
}

function hintFor(composable: string, callback: string): string {
  const base =
    `Call ${composable}(…) once in the defineSystem/defineActor setup and use the captured ` +
    `value inside ${callback}.`;
  if (composable !== "useService") return base;
  return (
    `${base} For a service that may be absent or swapped, keep optionalService(engine, key) ` +
    `from the setup and read .current inside ${callback}.`
  );
}

export const hotPathWarn: GwenSourceTransform = {
  name: "gwen:hot-path-warn",
  run(program, ctx) {
    const scopes = new Map<Node, Scope>();
    const stack: Scope[] = [];
    const pushed = new Set<Node>();
    walk(program, {
      enter(this: WalkerThisContextEnter, node) {
        const callee = node.type === "CallExpression" ? ctx.resolveCallee(node) : null;
        const guarded = isStatementLevel(node) || isFrameCallback(callee);
        if (guarded && ctx.isOptedOut(node)) {
          this.skip();
          return;
        }
        if (scopes.has(node)) {
          stack.push(scopes.get(node) ?? null);
          pushed.add(node);
          return;
        }
        if (node.type !== "CallExpression") return;
        if (isFrameCallback(callee)) {
          const first = node.arguments[0];
          if (first !== undefined && isFunctionNode(first)) scopes.set(first, callee);
          return;
        }
        if (isBarrier(callee)) {
          for (const argument of node.arguments) {
            if (isFunctionNode(argument)) scopes.set(argument, null);
          }
          return;
        }
        if (!isLookup(callee) || callee === null) return;
        const callback = stack[stack.length - 1];
        if (callback === undefined || callback === null) return;
        ctx.warn(
          ViteErrorCodes.HOT_PATH_LOOKUP,
          node,
          `Called inside ${callback}(); it runs every frame.`,
          { composable: callee, hint: hintFor(callee, callback) },
        );
      },
      leave(node) {
        if (!pushed.delete(node)) return;
        stack.pop();
      },
    });
    return [];
  },
};
