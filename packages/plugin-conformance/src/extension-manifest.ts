import { indexJson, isRecord } from "./json.js";
import type { JsonIndex } from "./json.js";
import type { PackageContext } from "./package-context.js";

/** One valid package name kept from `gwen.extends`. */
export interface ExtensionBase {
  readonly name: string;
  /** 1-based line of this `gwen.extends` element. */
  readonly line: number;
}

/** One shape problem of `gwen.extends`. */
export interface ExtensionProblem {
  readonly message: string;
  readonly hint: string;
  /** 1-based line of the key, or of the element. */
  readonly line: number;
}

/**
 * `name`, the kept bases of `gwen.extends`, and its shape problems.
 * `bases` is each valid, unique package name other than this package, in document order.
 * An absent field and an empty array add no problem.
 */
export interface ExtensionListing {
  readonly name: string;
  readonly bases: readonly ExtensionBase[];
  /** 1-based line of the `gwen.extends` key, or `1` when that key is absent. */
  readonly extendsLine: number;
  readonly problems: readonly ExtensionProblem[];
}

/**
 * A package name: optional `@scope/` plus one segment.
 * No further `/`, no space, no uppercase.
 */
const PACKAGE_NAME = /^(?:@[^\s/A-Z]+\/[^\s/A-Z]+|[^\s/@A-Z][^\s/A-Z]*)$/;

function packageNameOf(manifest: unknown): string {
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

function elementLine(index: JsonIndex, position: number, extendsLine: number): number {
  return index.valueLine(["gwen", "extends", String(position)]) ?? extendsLine;
}

function arrayProblem(line: number): ExtensionProblem {
  return {
    message: "gwen.extends must be an array of package names",
    hint: 'Write gwen.extends as an array of package names, for example ["fixture-base"].',
    line,
  };
}

function entryProblem(position: number, line: number): ExtensionProblem {
  return {
    message: `gwen.extends[${String(position)}] must be a package name string`,
    hint: 'Replace this entry with a package name string, for example "fixture-base".',
    line,
  };
}

function duplicateProblem(name: string, line: number): ExtensionProblem {
  return {
    message: `gwen.extends lists "${name}" twice`,
    hint: `List "${name}" once in gwen.extends.`,
    line,
  };
}

function selfProblem(line: number): ExtensionProblem {
  return {
    message: "gwen.extends lists the package itself",
    hint: "Remove this package's own name from gwen.extends.",
    line,
  };
}

function invalidNameProblem(value: string, line: number): ExtensionProblem {
  return {
    message: `gwen.extends entry "${value}" is not a package name`,
    hint: 'Write a package name: an optional @scope/ plus one segment, with no further slash, no space and no uppercase, for example "fixture-base".',
    line,
  };
}

interface ExtendsShape {
  readonly bases: readonly ExtensionBase[];
  readonly problems: readonly ExtensionProblem[];
}

function readExtends(
  value: unknown,
  index: JsonIndex,
  extendsLine: number,
  ownName: string,
): ExtendsShape {
  if (value === undefined) return { bases: [], problems: [] };
  if (!Array.isArray(value)) {
    return { bases: [], problems: [arrayProblem(extendsLine)] };
  }
  const bases: ExtensionBase[] = [];
  const problems: ExtensionProblem[] = [];
  const seen = new Set<string>();
  for (let position = 0; position < value.length; position += 1) {
    const entry: unknown = value[position];
    const line = elementLine(index, position, extendsLine);
    if (typeof entry !== "string") {
      problems.push(entryProblem(position, line));
      continue;
    }
    if (!PACKAGE_NAME.test(entry)) {
      problems.push(invalidNameProblem(entry, line));
      continue;
    }
    if (seen.has(entry)) {
      problems.push(duplicateProblem(entry, line));
      continue;
    }
    if (entry === ownName) {
      problems.push(selfProblem(line));
      seen.add(entry);
      continue;
    }
    seen.add(entry);
    bases.push({ name: entry, line });
  }
  return { bases, problems };
}

/** Read `name` and `gwen.extends` from the parsed manifest. No file I/O. */
export function readExtensionManifest(context: PackageContext): ExtensionListing {
  const index = indexJson(context.text);
  const extendsLine = index.keyLine(["gwen", "extends"]) ?? 1;
  const ownName = packageNameOf(context.manifest);
  const shape = readExtends(extendsField(context.manifest), index, extendsLine, ownName);
  return {
    name: ownName,
    bases: shape.bases,
    extendsLine,
    problems: shape.problems,
  };
}
