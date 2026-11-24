import { useEngine } from "@gwenjs/core";

interface CallHook {
  hooks: { callHook(name: string): void };
}

let captured: CallHook | undefined;

export function Plugin() {
  return {
    name: "late",
    setup() {
      const engine: CallHook = useEngine();
      captured = engine;
    },
  };
}

/** After the run, fire myplug:late on the engine setup captured. */
export function emitLate(): void {
  const engine = captured;
  if (engine === undefined) return;
  engine.hooks.callHook("myplug:late");
}
