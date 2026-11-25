import type { ResolvedConfig } from "vite";

const CORE = "@gwenjs/core";

type NoExternal = NonNullable<ResolvedConfig["ssr"]>["noExternal"];
type External = NonNullable<ResolvedConfig["ssr"]>["external"];

function matches(entry: string | RegExp): boolean {
  if (typeof entry === "string") return entry === CORE;
  entry.lastIndex = 0; // a /g or /y RegExp is stateful: a second resolve would miss
  return entry.test(CORE);
}

/**
 * True when `ssr.noExternal` makes Vite bundle `@gwenjs/core` into the server output.
 * An `ssr.external` array that lists `@gwenjs/core` wins over `noExternal` (Vite 8
 * `createIsConfiguredAsExternal` tests it first), so it keeps the package external. `external: true`
 * does not: Vite skips the list and reaches the `noExternal` checks.
 */
export function coversCore(noExternal: NoExternal, external: External): boolean {
  if (Array.isArray(external) && external.includes(CORE)) return false;
  if (noExternal === true) return true;
  if (noExternal === undefined) return false;
  return Array.isArray(noExternal) ? noExternal.some(matches) : matches(noExternal);
}
