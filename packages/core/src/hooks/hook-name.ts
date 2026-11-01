import { GwenHookNameError } from "../engine/engine-errors.js";

/**
 * Reject a hook name that is not `namespace:action`.
 * `forbidReserved` also rejects the core namespaces.
 * One `indexOf` on the success path. Not gated on `__GWEN_DEV__`.
 */
export function assertHookName(name: string, composable: string, forbidReserved: boolean): void {
  const i = name.indexOf(":");
  if (i <= 0 || i === name.length - 1) throw new GwenHookNameError(name, "format", composable);
  if (forbidReserved && isReservedNamespace(name, i)) {
    throw new GwenHookNameError(name, "reserved", composable);
  }
}

/** Equal to `GWEN_RESERVED_HOOK_NAMESPACES`. `"a:b:c"` stays valid: the first colon wins. */
function isReservedNamespace(name: string, colon: number): boolean {
  switch (colon) {
    case 5:
      return name.startsWith("scene:") || name.startsWith("actor:");
    case 6:
      return (
        name.startsWith("engine:") ||
        name.startsWith("entity:") ||
        name.startsWith("plugin:") ||
        name.startsWith("prefab:")
      );
    case 7:
      return name.startsWith("service:");
    default:
      return false;
  }
}
