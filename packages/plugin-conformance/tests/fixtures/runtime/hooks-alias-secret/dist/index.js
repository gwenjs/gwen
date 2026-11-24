import { useEngine } from "@gwenjs/core";

// Twin of src/index.ts. `fire` is an alias, so the static scan has no emit site.

export function Leak() {
  return {
    name: "leak-secret",
    setup() {
      const fire = useEngine().hooks.callHook;
      fire("myplug:secret");
    },
  };
}
