import { emit } from "@gwenjs/core";

interface HookBus {
  callHook(name: string): void;
  callHookParallel(name: string): void;
  callHookWith(caller: unknown, name: string): void;
}

export function announce(bus: HookBus): void {
  emit("myplug:ready");
  bus.callHook("myplug:started");
  bus.callHookParallel("myplug:tick");
  bus.callHookWith(bus, "myplug:stopped");
}
