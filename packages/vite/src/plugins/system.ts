import type { Plugin } from "vite";
import { createAstNameInjector } from "../shared/ast-name-injector.js";

/**
 * Transform `defineSystem` variable declarations to inject a name string as the
 * first argument, inferred from the declared variable name.
 * ...existing JSDoc...
 */
export const transformSystemNames = createAstNameInjector("defineSystem", (varName, args, s) => {
  if (args.length > 0 && args[0]!.type !== "Literal") {
    s.prependLeft(args[0]!.start, `'${varName}', `);
    return true;
  }
  return false;
});

/**
 * GWEN sub-plugin that injects debug names into `defineSystem()` calls.
 *
 * Transforms `export const ScoreSystem = defineSystem(() => { ... })` into
 * `export const ScoreSystem = defineSystem('ScoreSystem', () => { ... })` at
 * build time, so the engine can identify the system without requiring a manual
 * named-function form.
 *
 * Applies to all `.ts` / `.js` source files (excludes `.d.ts` and test files).
 *
 * @returns Vite plugin instance.
 */
export function gwenSystemPlugin(): Plugin {
  return {
    name: "gwen:system",
    transform(code, id) {
      if (id.endsWith(".d.ts") || id.endsWith(".test.ts") || id.endsWith(".test.js")) return;
      if (!/\.(ts|js)x?$/.test(id)) return;
      if (!code.includes("defineSystem")) return;
      const transformed = transformSystemNames(code, id);
      if (transformed === code) return;
      return { code: transformed, map: null };
    },
  };
}
