import { useEngine } from "@gwenjs/core";

// Twin of src/index.ts. useEngine() is the real engine during setup
// (packages/core/src/engine/plugin-registry.ts:310).

export function Good() {
  return { name: "good", setup() {} };
}

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
