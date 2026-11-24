import { readFile } from "node:fs/promises";
import path from "node:path";
import { installedHookNamespace } from "../installed-package.js";
import { isRecord } from "../json.js";

/**
 * Parsed `package.json` fields the loader needs.
 * `moduleTarget` is set only when `./module` is present.
 * `extensionTarget` is set only when `./extension` is present.
 * `gwenExtends` is the non-empty strings of `gwen.extends`, in order, without duplicates.
 */
export interface RuntimeManifest {
  readonly name: string;
  readonly rootTarget: string;
  readonly moduleTarget: string | undefined;
  readonly extensionTarget: string | undefined;
  readonly gwenExtends: readonly string[];
  readonly hookNamespace: string | undefined;
}

/** Non-empty strings of `gwen.extends`, in order, without duplicates. An absent field is `[]`. */
export function readGwenExtends(manifest: unknown): readonly string[] {
  if (!isRecord(manifest)) return [];
  const gwen = manifest.gwen;
  if (!isRecord(gwen)) return [];
  const value = gwen.extends;
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    names.push(entry);
  }
  return names;
}

export type ManifestLoad =
  | { readonly ok: true; readonly manifest: RuntimeManifest }
  | { readonly ok: false; readonly message: string; readonly hint: string };

export type LocatedFile =
  | { readonly ok: true; readonly file: string }
  | { readonly ok: false; readonly message: string; readonly hint: string };

function fail(message: string, hint: string): ManifestLoad {
  return { ok: false, message, hint };
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function packageJsonAbsent(file: string): ManifestLoad {
  return fail(`${file} is absent`, "Add a package.json file at the package root.");
}

function packageJsonUnreadable(file: string, code: string): ManifestLoad {
  return fail(`${file} cannot be read (${code})`, "Make package.json a readable UTF-8 file.");
}

/**
 * Resolve `target` (`exports[subpath].import`) to a file under `root`.
 * A target under `<root>/src` is rejected here and never opened.
 */
export function locateBuiltFile(root: string, subpath: string, target: string): LocatedFile {
  const label = `exports[${JSON.stringify(subpath)}].import`;
  if (!target.startsWith("./")) {
    return {
      ok: false,
      message: `${label} ${JSON.stringify(target)} must start with "./"`,
      hint: "Point import at a relative file inside the package, under the build output.",
    };
  }
  const relative = path.relative(root, path.resolve(root, target));
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return {
      ok: false,
      message: `${label} ${JSON.stringify(target)} resolves outside the package root`,
      hint: "Point import at a file inside the package root.",
    };
  }
  if (relative === "src" || relative.startsWith(`src${path.sep}`)) {
    return {
      ok: false,
      message: `${label} ${JSON.stringify(target)} is under src`,
      hint: "Point import at the built file. Runtime checks do not load src.",
    };
  }
  return { ok: true, file: path.resolve(root, target) };
}

function readImport(
  file: string,
  exportsValue: Record<string, unknown>,
  subpath: string,
): string | ManifestLoad {
  const label = `exports[${JSON.stringify(subpath)}].import`;
  const entry = exportsValue[subpath];
  if (!isRecord(entry)) {
    return fail(
      `${file} ${label} must be a string on an object`,
      "Set the subpath to an object whose import is the built file.",
    );
  }
  const imported = entry.import;
  if (typeof imported !== "string" || imported.length === 0) {
    return fail(
      `${file} ${label} must be a non-empty string`,
      "Point import at the built file, for example ./dist/index.js.",
    );
  }
  return imported;
}

function readTargets(file: string, name: string, manifest: Record<string, unknown>): ManifestLoad {
  const exportsValue = manifest.exports;
  if (!isRecord(exportsValue)) {
    return fail(`${file} exports must be an object`, "Set exports to an object of subpaths.");
  }
  const rootTarget = readImport(file, exportsValue, ".");
  if (typeof rootTarget !== "string") return rootTarget;
  let moduleTarget: string | undefined;
  if (Object.hasOwn(exportsValue, "./module")) {
    const read = readImport(file, exportsValue, "./module");
    if (typeof read !== "string") return read;
    moduleTarget = read;
  }
  let extensionTarget: string | undefined;
  if (Object.hasOwn(exportsValue, "./extension")) {
    const read = readImport(file, exportsValue, "./extension");
    if (typeof read !== "string") return read;
    extensionTarget = read;
  }
  return {
    ok: true,
    manifest: {
      name,
      rootTarget,
      moduleTarget,
      extensionTarget,
      gwenExtends: readGwenExtends(manifest),
      hookNamespace: installedHookNamespace(manifest),
    },
  };
}

/** Read `<root>/package.json`. A bad file is a result, not a throw. */
export async function readRuntimeManifest(root: string): Promise<ManifestLoad> {
  const file = path.join(root, "package.json");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const code = readErrorCode(error);
    if (code === "ENOENT") return packageJsonAbsent(file);
    return packageJsonUnreadable(file, code ?? "unknown");
  }
  let parsed: unknown;
  try {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    parsed = JSON.parse(text);
  } catch {
    return fail(`${file} is not valid JSON`, "Fix the JSON syntax in package.json.");
  }
  if (!isRecord(parsed)) {
    return fail(
      `${file} must be a JSON object`,
      "Set package.json to an object with name and exports.",
    );
  }
  const name = parsed.name;
  if (typeof name !== "string" || name.length === 0) {
    return fail(
      `${file} name must be a non-empty string`,
      "Set the name field of package.json to the package name.",
    );
  }
  return readTargets(file, name, parsed);
}
