/**
 * Canonical callee to the module sources that export it.
 * One table. Later passes only append a source.
 */

import type { GwenCallee } from "./types.js";

/** Every framework callee, in union order. */
const CALLEE_NAMES: readonly GwenCallee[] = [
  "defineSystem",
  "onUpdate",
  "useQuery",
  "useComponent",
  "defineScene",
  "onEnter",
  "onExit",
  "onPreload",
  "onTransitionExit",
  "defineSceneRouter",
  "defineActor",
  "definePrefab",
  "useActor",
  "defineLayout",
  "withAsyncContext",
  "defineLayers",
  "useMeshCollider",
  "defineHooks",
  "useTween",
  "onBeforeUpdate",
  "onAfterUpdate",
  "onRender",
  "useService",
  "useWasmModule",
];

export const CANONICAL: Record<GwenCallee, readonly string[]> = {
  defineSystem: ["@gwenjs/core/system"],
  onUpdate: ["@gwenjs/core/system"],
  useQuery: ["@gwenjs/core/system"],
  useComponent: ["@gwenjs/core/system"],
  defineScene: ["@gwenjs/core/scene"],
  onEnter: ["@gwenjs/core/scene"],
  onExit: ["@gwenjs/core/scene"],
  onPreload: ["@gwenjs/core/scene"],
  onTransitionExit: ["@gwenjs/core/scene"],
  defineSceneRouter: ["@gwenjs/core/scene"],
  defineActor: ["@gwenjs/core/actor"],
  definePrefab: ["@gwenjs/core/actor"],
  useActor: ["@gwenjs/core/actor"],
  defineLayout: ["@gwenjs/core/actor"],
  withAsyncContext: ["@gwenjs/core"],
  defineLayers: ["@gwenjs/physics2d", "@gwenjs/physics3d", "@gwenjs/physics-core"],
  useMeshCollider: ["@gwenjs/physics3d"],
  defineHooks: ["@gwenjs/core"],
  useTween: ["@gwenjs/core/tween"],
  onBeforeUpdate: ["@gwenjs/core/system"],
  onAfterUpdate: ["@gwenjs/core/system"],
  onRender: ["@gwenjs/core/system"],
  useService: ["@gwenjs/core/system"],
  useWasmModule: ["@gwenjs/core/system"],
};

/** Virtual modules that re-export the auto-import list. Not canonical sources. */
export const VIRTUAL_SOURCES: readonly string[] = ["#gwen", "virtual:gwen/auto-imports"];

export function isVirtualSource(source: string): boolean {
  for (const item of VIRTUAL_SOURCES) {
    if (item === source) return true;
  }
  return false;
}

function knownCallee(name: string): GwenCallee | null {
  for (const item of CALLEE_NAMES) {
    if (item === name) return item;
  }
  return null;
}

/** Callee for an import, or null when the name or the source is not canonical. */
export function calleeFor(source: string, imported: string): GwenCallee | null {
  const name = knownCallee(imported);
  if (name === null) return null;
  for (const item of CANONICAL[name]) {
    if (item === source) return name;
  }
  return null;
}
