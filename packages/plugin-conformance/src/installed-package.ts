import path from "node:path";
import { isRecord } from "./json.js";
import { readTextIfPresent } from "./source-files.js";

/**
 * One `node_modules/<pkg>/package.json` lookup.
 * `"absent"` — the file is not there.
 * `"unparsed"` — the file is there and `JSON.parse` rejects it.
 * `"found"` — the parsed JSON value.
 */
export type InstalledPackage =
  | { readonly kind: "absent" }
  | { readonly kind: "unparsed" }
  | { readonly kind: "found"; readonly manifest: unknown };

/** Non-empty `gwen.hookNamespace` string of an installed manifest, or `undefined`. */
export function installedHookNamespace(manifest: unknown): string | undefined {
  if (!isRecord(manifest)) return undefined;
  const gwen = manifest.gwen;
  if (!isRecord(gwen)) return undefined;
  const value = gwen.hookNamespace;
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}

/** Read `node_modules/<pkg>/package.json` in `directory` only. Ancestors are not walked. */
async function readInstalledPackage(directory: string, pkg: string): Promise<InstalledPackage> {
  const text = await readTextIfPresent(path.join(directory, "node_modules", pkg, "package.json"));
  if (text === undefined) return { kind: "absent" };
  try {
    const manifest: unknown = JSON.parse(text);
    return { kind: "found", manifest };
  } catch {
    return { kind: "unparsed" };
  }
}

/**
 * Resolve `pkg` the way Node resolves `node_modules`: start at `root`, then each ancestor,
 * and stop at the filesystem root.
 */
export async function resolveInstalledPackage(
  root: string,
  pkg: string,
): Promise<InstalledPackage> {
  let directory = path.resolve(root);
  for (;;) {
    const installed = await readInstalledPackage(directory, pkg);
    if (installed.kind !== "absent") return installed;
    const parent = path.dirname(directory);
    if (parent === directory) return { kind: "absent" };
    directory = parent;
  }
}
