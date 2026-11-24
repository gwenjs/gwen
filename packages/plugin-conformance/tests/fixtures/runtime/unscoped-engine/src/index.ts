import { useEngine } from "@gwenjs/core";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    leakKey: { readonly marker: string };
  }
}

// setup receives a proxy. useEngine() during that call is the real engine
// (packages/core/src/engine/plugin-registry.ts:310). Hooks and provide on it
// are not tracked (packages/core/src/engine/plugin-registry.ts:727,
// packages/core/src/engine/hook-tracker.ts:27,
// packages/core/src/engine/gwen-engine.ts:237).

export function LeakHook() {
  return {
    name: "unscoped-hook",
    setup() {
      useEngine().hooks.hook("engine:update", () => {});
    },
  };
}

export function LeakProvide() {
  return {
    name: "unscoped-provide",
    provides: ["leakKey"],
    setup() {
      useEngine().provide("leakKey", { marker: "leak" });
    },
  };
}
