/**
 * Follow project barrel re-exports to the module that defines the name.
 * The cache is owned by one pipeline instance. A barrel outside the project
 * root (a monorepo sibling) is left untouched. Editing a barrel does not
 * retransform its importers until those importers change.
 * A star bound to a namespace, and a namespace read through a barrel, stay unresolved.
 * A `#gwen` re-export stays `{ source: "#gwen", imported: "sys" }`. It is not mapped through the auto-import list.
 */

import { readFile } from "node:fs/promises";
import type { ExportNamedDeclaration, ModuleExportName, Program } from "oxc-parser";
import { GwenError } from "@gwenjs/schema";
import type { Alias } from "vite";
import { ViteErrorCodes } from "../error-codes.js";
import { calleeFor, CANONICAL, isVirtualSource } from "./canonical.js";
import { buildImportTable, type ImportBinding } from "./import-table.js";
import { isScriptModule, parseModule, pathWithoutQuery } from "./parse.js";
import type { GwenImportBinding } from "./types.js";

/** One re-export. `imported` is the name in `source`. */
interface ImportRef {
  readonly source: string;
  readonly imported: string;
}

/** Re-exports of one barrel file, in source order. */
export interface Barrels {
  readonly named: ReadonlyMap<string, ImportRef>;
  readonly stars: readonly string[];
}

export interface BarrelDeps {
  readonly importer: string;
  readonly root: string;
  readonly aliases: readonly Alias[];
  readonly cache: Map<string, Barrels>;
  resolve(specifier: string, importer: string): Promise<{ readonly id: string } | null>;
}

/**
 * Steps past the first barrel file. `f0` is 0 and `f8` is still accepted.
 * `f9` is past the bound.
 */
const BARREL_DEPTH = 8;

function exportName(name: ModuleExportName): string {
  if (name.type === "Identifier") return name.name;
  return name.value;
}

function isCanonicalSource(source: string): boolean {
  for (const sources of Object.values(CANONICAL)) {
    for (const item of sources) {
      if (item === source) return true;
    }
  }
  return false;
}

function isProjectSpecifier(specifier: string, aliases: readonly Alias[]): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return true;
  for (const alias of aliases) {
    const find = alias.find;
    if (typeof find !== "string") continue;
    if (find.length === 0) continue;
    if (specifier === find || specifier.startsWith(`${find}/`)) return true;
  }
  return false;
}

function isTerminalSource(source: string, aliases: readonly Alias[]): boolean {
  if (isCanonicalSource(source) || isVirtualSource(source)) return true;
  return !isProjectSpecifier(source, aliases);
}

function isInsideRoot(file: string, root: string): boolean {
  if (root.length === 0) return false;
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  if (base.length === 0) return false;
  return file.startsWith(`${base}/`);
}

function putNamed(named: Map<string, ImportRef>, key: string, ref: ImportRef): void {
  if (named.has(key)) return;
  named.set(key, ref);
}

function addFromSource(
  source: string,
  statement: ExportNamedDeclaration,
  named: Map<string, ImportRef>,
): void {
  for (const spec of statement.specifiers) {
    if (spec.exportKind === "type") continue;
    const local = exportName(spec.local);
    const exported = exportName(spec.exported);
    putNamed(named, exported, { source, imported: local });
  }
}

function addLocalReexport(
  statement: ExportNamedDeclaration,
  imports: ReadonlyMap<string, ImportBinding>,
  named: Map<string, ImportRef>,
): void {
  for (const spec of statement.specifiers) {
    if (spec.exportKind === "type") continue;
    const local = exportName(spec.local);
    const exported = exportName(spec.exported);
    const row = imports.get(local);
    if (row === undefined || row.kind === "namespace") continue;
    putNamed(named, exported, { source: row.source, imported: row.imported });
  }
}

function extractBarrels(program: Program): Barrels {
  const imports = buildImportTable(program);
  const named = new Map<string, ImportRef>();
  const stars: string[] = [];
  for (const statement of program.body) {
    if (statement.type === "ExportAllDeclaration") {
      if (statement.exportKind === "type") continue;
      if (statement.exported !== null) continue;
      stars.push(statement.source.value);
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.exportKind === "type") continue;
    const source = statement.source;
    if (source !== null) {
      addFromSource(source.value, statement, named);
      continue;
    }
    addLocalReexport(statement, imports, named);
  }
  return { named, stars };
}

async function readSource(id: string): Promise<string | null> {
  try {
    return await readFile(pathWithoutQuery(id), "utf8");
  } catch {
    return null;
  }
}

async function loadBarrels(id: string, cache: Map<string, Barrels>): Promise<Barrels | null> {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const code = await readSource(id);
  if (code === null) return null;
  const program = parseBarrel(id, code);
  if (program === null) return null;
  const barrels = extractBarrels(program);
  cache.set(id, barrels);
  return barrels;
}

function parseBarrel(id: string, code: string): Program | null {
  try {
    return parseModule(id, code).program;
  } catch (caught) {
    if (caught instanceof GwenError && caught.code === ViteErrorCodes.TRANSFORM_PARSE_FAILED) {
      return null;
    }
    throw caught;
  }
}

async function resolveFile(
  specifier: string,
  importer: string,
  deps: BarrelDeps,
): Promise<string | null> {
  const resolved = await deps.resolve(specifier, importer);
  if (resolved === null) return null;
  const id = resolved.id;
  if (id.includes("\0")) return null;
  if (id.includes("/node_modules/")) return null;
  if (id.includes("?")) return null;
  if (!isScriptModule(id)) return null;
  if (!isInsideRoot(pathWithoutQuery(id), deps.root)) return null;
  return id;
}

async function resolveExport(
  specifier: string,
  importer: string,
  exported: string,
  deps: BarrelDeps,
  depth: number,
  seen: ReadonlySet<string>,
): Promise<GwenImportBinding | null> {
  if (depth > BARREL_DEPTH) return null;
  const id = await resolveFile(specifier, importer, deps);
  if (id === null) return null;
  if (seen.has(id)) return null;
  const barrels = await loadBarrels(id, deps.cache);
  if (barrels === null) return null;
  const next = new Set(seen);
  next.add(id);
  return walkBarrel(barrels, id, exported, deps, depth, next);
}

async function followRef(
  ref: ImportRef,
  importer: string,
  deps: BarrelDeps,
  depth: number,
  seen: ReadonlySet<string>,
): Promise<GwenImportBinding | null> {
  if (isTerminalSource(ref.source, deps.aliases)) {
    return { source: ref.source, imported: ref.imported };
  }
  return resolveExport(ref.source, importer, ref.imported, deps, depth + 1, seen);
}

async function walkBarrel(
  barrels: Barrels,
  id: string,
  exported: string,
  deps: BarrelDeps,
  depth: number,
  seen: ReadonlySet<string>,
): Promise<GwenImportBinding | null> {
  const named = barrels.named.get(exported);
  if (named !== undefined) return followRef(named, id, deps, depth, seen);
  for (const star of barrels.stars) {
    if (isCanonicalSource(star)) {
      if (calleeFor(star, exported) !== null) return { source: star, imported: exported };
      continue;
    }
    if (!isProjectSpecifier(star, deps.aliases)) continue;
    const found = await resolveExport(star, id, exported, deps, depth + 1, seen);
    if (found !== null) return found;
  }
  return null;
}

/** Final binding per local import name. Canonical and virtual specifiers are not resolved. */
export async function followBarrels(
  table: ReadonlyMap<string, ImportBinding>,
  deps: BarrelDeps,
): Promise<Map<string, GwenImportBinding>> {
  const followed = new Map<string, GwenImportBinding>();
  for (const [local, row] of table) {
    if (row.kind === "namespace") continue;
    if (isCanonicalSource(row.source) || isVirtualSource(row.source)) continue;
    if (!isProjectSpecifier(row.source, deps.aliases)) continue;
    const binding = await resolveExport(
      row.source,
      deps.importer,
      row.imported,
      deps,
      0,
      new Set(),
    );
    if (binding !== null) followed.set(local, binding);
  }
  return followed;
}
