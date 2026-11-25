import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConformanceErrorCodes } from "../error-codes.js";
import { readGwenContract, sortedUnique } from "../gwen-contract.js";
import { indexJson, isRecord } from "../json.js";
import type { JsonIndex } from "../json.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin } from "./call-factory.js";
import { runtimeRoot } from "./load-package.js";
import type { RuntimeCheckContext } from "./types.js";

/** One list of the contract: the `gwen` path of its key, and its name in a message. */
interface ContractKey {
  readonly label: string;
  readonly path: readonly string[];
}

const CONTRACT_KEYS: readonly ContractKey[] = [
  { label: "provides", path: ["provides"] },
  { label: "requires.plugins", path: ["requires", "plugins"] },
  { label: "requires.services", path: ["requires", "services"] },
  { label: "requires.optional", path: ["requires", "optional"] },
];

/** The lists one side of the comparison holds, by `ContractKey.label`. */
type Lists = ReadonlyMap<string, readonly string[]>;

/** The string entries of `value`. Anything else reads as an empty list. */
function stringEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") names.push(entry);
  }
  return names;
}

/** `requires.plugins` by name: a string entry is its name, an `{ name }` entry is `name`. */
function pluginNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") names.push(entry);
    else if (isRecord(entry) && typeof entry.name === "string") names.push(entry.name);
  }
  return names;
}

/** The four lists of one plugin instance, as the instance declares them. */
function instanceLists(plugin: Record<string, unknown>): Map<string, string[]> {
  const requires: unknown = plugin.requires;
  const required = isRecord(requires) ? requires : {};
  return new Map([
    ["provides", stringEntries(plugin.provides)],
    ["requires.plugins", pluginNames(required.plugins)],
    ["requires.services", stringEntries(required.services)],
    ["requires.optional", stringEntries(required.optional)],
  ]);
}

/** The union over every factory of the package. A factory that throws or is no plugin adds nothing. */
function unionOfFactories(context: RuntimeCheckContext): Lists {
  const union = new Map<string, string[]>(CONTRACT_KEYS.map((key) => [key.label, []]));
  for (const factory of context.packageFactories) {
    const created: unknown = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created) || !isRecord(created)) continue;
    for (const [label, names] of instanceLists(created)) union.get(label)?.push(...names);
  }
  return union;
}

/** The lists `package.json` declares, by `ContractKey.label`. */
function manifestLists(parsed: unknown, text: string): Lists | undefined {
  const contract = readGwenContract(parsed, text);
  if (contract.problems.length > 0) return undefined;
  return new Map([
    ["provides", contract.provides],
    ["requires.plugins", contract.requires.plugins],
    ["requires.services", contract.requires.services],
    ["requires.optional", contract.requires.optional],
  ]);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

/** Line of `gwen.<key>`, else of `gwen`, else 1. */
function driftLine(index: JsonIndex, key: ContractKey): number {
  return index.keyLine(["gwen", ...key.path]) ?? index.keyLine(["gwen"]) ?? 1;
}

function driftFinding(
  index: JsonIndex,
  key: ContractKey,
  declared: readonly string[],
  actual: readonly string[],
): ConformanceFinding {
  const wanted = JSON.stringify(actual);
  return {
    code: ConformanceErrorCodes.MANIFEST,
    message: `gwen.${key.label} ${JSON.stringify(declared)} differs from the ${key.label} of the plugins ${wanted}`,
    hint: `Set gwen.${key.label} in package.json to ${wanted}.`,
    file: "package.json",
    line: driftLine(index, key),
  };
}

/** The parsed `package.json` of the package under test and its text, BOM stripped. */
async function readPackageJson(
  context: RuntimeCheckContext,
): Promise<{ readonly parsed: unknown; readonly text: string } | undefined> {
  try {
    let text = await readFile(path.join(runtimeRoot(context.spec), "package.json"), "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const parsed: unknown = JSON.parse(text);
    return { parsed, text };
  } catch {
    return undefined;
  }
}

/** True when `package.json` has `gwen.type` equal to `"plugin"`. */
export function isPluginPackage(parsed: unknown): boolean {
  if (!isRecord(parsed)) return false;
  const gwen: unknown = parsed.gwen;
  return isRecord(gwen) && gwen.type === "plugin";
}

/**
 * RD1. `gwen.provides` and `gwen.requires.{plugins,services,optional}` of `package.json`
 * against the union over every factory of the package. One finding per drifting key.
 * Returns `undefined` when the check does not run: `gwen.type` is not `"plugin"`.
 * A malformed field is left to the `manifest` check, so the comparison is skipped.
 */
export async function checkManifestContract(
  context: RuntimeCheckContext,
): Promise<ConformanceFinding[] | undefined> {
  const manifest = await readPackageJson(context);
  if (manifest === undefined || !isPluginPackage(manifest.parsed)) return undefined;
  const declared = manifestLists(manifest.parsed, manifest.text);
  if (declared === undefined) return [];
  const actual = unionOfFactories(context);
  const index = indexJson(manifest.text);
  const findings: ConformanceFinding[] = [];
  for (const key of CONTRACT_KEYS) {
    const wanted = sortedUnique(actual.get(key.label) ?? []);
    const written = sortedUnique(declared.get(key.label) ?? []);
    if (sameList(written, wanted)) continue;
    findings.push(driftFinding(index, key, written, wanted));
  }
  return findings;
}
