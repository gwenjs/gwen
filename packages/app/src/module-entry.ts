/**
 * @file Resolve an npm module to its `./module` entry.
 *
 * One rule for the Vite loader and for `GwenApp`'s default loader.
 * No fallback to `exports["."]`, `main`, or `index.js`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { GwenError } from "@gwenjs/schema";
import { AppErrorCodes } from "./error-codes";

/** Read `key` from `value` when it is an object, else `undefined`. */
function readField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/**
 * Absolute path of `<root>/node_modules/<name>`'s `./module` entry.
 *
 * `exports["./module"]` may be a string, or an object whose `import`
 * condition wins over `default`. A missing `package.json` throws the
 * filesystem error. Anything else throws `APP:MODULE_ENTRY_MISSING`.
 *
 * @param root - Project root that holds `node_modules`.
 * @param name - Npm package name, scoped or not.
 */
export function resolveModuleEntry(root: string, name: string): string {
  const parts = name.startsWith("@") ? name.split("/").slice(0, 2) : [name];
  const pkgDir = path.join(root, "node_modules", ...parts);
  const pkgJson: unknown = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf-8"));
  const entry = moduleExport(readField(pkgJson, "exports"));
  if (entry === undefined) {
    throw new GwenError(
      AppErrorCodes.MODULE_ENTRY_MISSING,
      `${name} declares no ./module export.`,
      {
        composable: "setupModules",
        hint: __GWEN_DEV__
          ? "A GWEN module package must export ./module (defineGwenModule). Update the package or remove it from modules."
          : undefined,
      },
    );
  }
  return path.join(pkgDir, entry);
}

/** String path of `exports["./module"]`, or `undefined` when it is absent. */
function moduleExport(exp: unknown): string | undefined {
  const sub = readField(exp, "./module");
  if (typeof sub === "string") return sub;
  if (typeof sub !== "object" || sub === null) return undefined;
  const picked = readField(sub, "import") ?? readField(sub, "default");
  return typeof picked === "string" ? picked : undefined;
}
