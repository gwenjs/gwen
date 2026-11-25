import { indexJson, isRecord } from "./json.js";
import type { JsonIndex } from "./json.js";

/** One shape problem of `gwen.provides` or `gwen.requires`. */
export interface GwenProblem {
  readonly message: string;
  readonly hint: string;
  /** 1-based line of the key, or of the entry. */
  readonly line: number;
}

/** The lists of `gwen.requires`, each one valid, unique, in document order. */
export interface GwenRequires {
  readonly plugins: readonly string[];
  readonly services: readonly string[];
  readonly optional: readonly string[];
}

/**
 * What `package.json` declares in `gwen.provides` and `gwen.requires`.
 * An absent field, an absent key and a field of the wrong type read as an empty list.
 * A list keeps the entries that are non-empty strings, each name once, in document order.
 * Keys directly under `gwen` other than `provides` and `requires` are never read.
 */
export interface GwenContract {
  readonly provides: readonly string[];
  readonly requires: GwenRequires;
  readonly problems: readonly GwenProblem[];
}

const REQUIRES_KEYS = ["plugins", "services", "optional"] as const;

type RequiresKey = (typeof REQUIRES_KEYS)[number];

interface ListShape {
  readonly values: readonly string[];
  readonly problems: readonly GwenProblem[];
}

function isRequiresKey(key: string): key is RequiresKey {
  return REQUIRES_KEYS.some((known) => known === key);
}

/** The values of `names` once each, sorted by code unit. */
export function sortedUnique(names: readonly string[]): string[] {
  return [...new Set(names)].sort((left, right) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
}

function listProblem(label: string, noun: string, line: number): GwenProblem {
  return {
    message: `${label} must be an array of ${noun}`,
    hint: `Write ${label} as an array of ${noun}, for example ["fixture:svc"].`,
    line,
  };
}

function entryProblem(label: string, position: number, line: number): GwenProblem {
  return {
    message: `${label}[${String(position)}] must be a non-empty string`,
    hint: `Replace this entry of ${label} with a non-empty string.`,
    line,
  };
}

function duplicateProblem(label: string, name: string, line: number): GwenProblem {
  return {
    message: `${label} lists "${name}" twice`,
    hint: `List "${name}" once in ${label}.`,
    line,
  };
}

/** One list: `value` is the field at `path`, `label` is its name in a message. */
function readList(
  value: unknown,
  label: string,
  noun: string,
  path: readonly string[],
  index: JsonIndex,
): ListShape {
  if (value === undefined) return { values: [], problems: [] };
  const keyLine = index.keyLine(path) ?? 1;
  if (!Array.isArray(value)) {
    return { values: [], problems: [listProblem(label, noun, keyLine)] };
  }
  const values: string[] = [];
  const problems: GwenProblem[] = [];
  for (let position = 0; position < value.length; position += 1) {
    const entry: unknown = value[position];
    const line = index.valueLine([...path, String(position)]) ?? keyLine;
    if (typeof entry !== "string" || entry === "") {
      problems.push(entryProblem(label, position, line));
      continue;
    }
    if (values.includes(entry)) {
      problems.push(duplicateProblem(label, entry, line));
      continue;
    }
    values.push(entry);
  }
  return { values, problems };
}

function unknownKeyProblem(key: string, line: number): GwenProblem {
  return {
    message: `gwen.requires has the unknown key "${key}"`,
    hint: "Use plugins, services or optional.",
    line,
  };
}

function requiresProblem(line: number): GwenProblem {
  return {
    message: "gwen.requires must be an object",
    hint: "Write gwen.requires as an object with the keys plugins, services and optional.",
    line,
  };
}

function requiresField(value: unknown, key: RequiresKey): unknown {
  if (!isRecord(value) || !Object.hasOwn(value, key)) return undefined;
  return value[key];
}

/** The `gwen.requires` lists of `value`, and the problems of its shape. */
function readRequires(
  value: unknown,
  index: JsonIndex,
): { readonly requires: GwenRequires; readonly problems: readonly GwenProblem[] } {
  const empty: GwenRequires = { plugins: [], services: [], optional: [] };
  if (value === undefined) return { requires: empty, problems: [] };
  if (!isRecord(value)) {
    const line = index.keyLine(["gwen", "requires"]) ?? 1;
    return { requires: empty, problems: [requiresProblem(line)] };
  }
  const problems: GwenProblem[] = [];
  for (const key of Object.keys(value)) {
    if (isRequiresKey(key)) continue;
    const line = index.keyLine(["gwen", "requires", key]) ?? 1;
    problems.push(unknownKeyProblem(key, line));
  }
  const lists = REQUIRES_KEYS.map((key) =>
    readList(
      requiresField(value, key),
      `gwen.requires.${key}`,
      "names",
      ["gwen", "requires", key],
      index,
    ),
  );
  for (const list of lists) problems.push(...list.problems);
  const [plugins = [], services = [], optional = []] = lists.map((list) => list.values);
  return { requires: { plugins, services, optional }, problems };
}

function gwenField(manifest: unknown, key: string): unknown {
  if (!isRecord(manifest)) return undefined;
  const gwen = manifest.gwen;
  if (!isRecord(gwen) || !Object.hasOwn(gwen, key)) return undefined;
  return gwen[key];
}

/**
 * Read `gwen.provides` and `gwen.requires` from the parsed manifest. No file I/O.
 * `text` is the same `package.json` text, used only to find lines.
 */
export function readGwenContract(manifest: unknown, text: string): GwenContract {
  const index = indexJson(text);
  const provides = readList(
    gwenField(manifest, "provides"),
    "gwen.provides",
    "service keys",
    ["gwen", "provides"],
    index,
  );
  const requires = readRequires(gwenField(manifest, "requires"), index);
  return {
    provides: provides.values,
    requires: requires.requires,
    problems: [...provides.problems, ...requires.problems],
  };
}
