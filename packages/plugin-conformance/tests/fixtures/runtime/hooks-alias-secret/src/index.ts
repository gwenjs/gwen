// The static check stays silent here: `fire` is an alias, not a syntactic emit site.
// The runtime check reports "myplug:secret" as CONFORMANCE:HOOK_UNDECLARED
// (packages/plugin-conformance/tests/fixtures/hooks/real-engine-bypass/src/index.ts:1-2).
import { useEngine } from "@gwenjs/core";

export function Leak() {
  return {
    name: "leak-secret",
    setup() {
      const fire = useEngine().hooks.callHook;
      fire("myplug:secret");
    },
  };
}
