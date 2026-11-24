import { indexJson, isRecord } from "./json.js";
import type { JsonIndex } from "./json.js";
import type { PackageContext } from "./package-context.js";

/** One string entry of `gwen.extends`. */
export interface ExtensionBase {
  readonly name: string;
  /** 1-based line of this `gwen.extends` element. */
  readonly line: number;
}

/**
 * `name` and the string entries of `gwen.extends` from an already parsed `package.json`.
 * A value that is not an array, and an entry that is not a string, are left out.
 */
export interface ExtensionListing {
  readonly name: string;
  readonly bases: readonly ExtensionBase[];
  /** 1-based line of the `gwen.extends` key, or `1` when that key is absent. */
  readonly extendsLine: number;
}

function packageName(manifest: unknown): string {
  if (!isRecord(manifest)) return "";
  const name = manifest.name;
  return typeof name === "string" ? name : "";
}

function extendsField(manifest: unknown): unknown {
  if (!isRecord(manifest)) return undefined;
  const gwen = manifest.gwen;
  if (!isRecord(gwen)) return undefined;
  return gwen.extends;
}

function stringBases(
  value: unknown,
  index: JsonIndex,
  extendsLine: number,
): readonly ExtensionBase[] {
  if (!Array.isArray(value)) return [];
  const bases: ExtensionBase[] = [];
  for (let position = 0; position < value.length; position += 1) {
    const entry = value[position];
    if (typeof entry !== "string") continue;
    bases.push({
      name: entry,
      line: index.valueLine(["gwen", "extends", String(position)]) ?? extendsLine,
    });
  }
  return bases;
}

/** Read `name` and `gwen.extends` from the parsed manifest. No file I/O. */
export function readExtensionManifest(context: PackageContext): ExtensionListing {
  const index = indexJson(context.text);
  const extendsLine = index.keyLine(["gwen", "extends"]) ?? 1;
  return {
    name: packageName(context.manifest),
    bases: stringBases(extendsField(context.manifest), index, extendsLine),
    extendsLine,
  };
}
