// The static check stays silent here: `fire` is an alias, not a syntactic emit site.
// The runtime check of PC-4 reports "myplug:secret" as CONFORMANCE:HOOK_UNDECLARED.
interface Engine {
  hooks: { callHook(name: string): void };
}

export function leak(engine: Engine): void {
  const fire = engine.hooks.callHook;
  fire("myplug:secret");
}
