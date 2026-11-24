import { useEngine } from "@gwenjs/core";

// Twin of src/index.ts. emitLate fires after the conformance run returns.

let captured;

export function Plugin() {
  return {
    name: "late",
    setup() {
      captured = useEngine();
    },
  };
}

export function emitLate() {
  const engine = captured;
  if (engine === undefined) return;
  engine.hooks.callHook("myplug:late");
}
