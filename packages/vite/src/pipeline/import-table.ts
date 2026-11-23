/**
 * Local binding to the import it came from.
 * Type-only declarations and specifiers are omitted.
 */

import type { ImportDeclaration, ModuleExportName, Program } from "oxc-parser";

export type ImportKind = "named" | "default" | "namespace";

export interface ImportBinding {
  readonly source: string;
  readonly imported: string;
  readonly kind: ImportKind;
}

function isTypeOnly(kind: "value" | "type" | undefined): boolean {
  return kind === "type";
}

/** Imported name. A string literal uses its value. A default import is not handled here. */
function importedName(imported: ModuleExportName): string {
  if (imported.type === "Identifier") return imported.name;
  return imported.value;
}

function addSpecifiers(statement: ImportDeclaration, table: Map<string, ImportBinding>): void {
  const source = statement.source.value;
  for (const spec of statement.specifiers) {
    if (spec.type === "ImportSpecifier") {
      if (isTypeOnly(spec.importKind)) continue;
      table.set(spec.local.name, {
        source,
        imported: importedName(spec.imported),
        kind: "named",
      });
      continue;
    }
    if (spec.type === "ImportDefaultSpecifier") {
      table.set(spec.local.name, { source, imported: "default", kind: "default" });
      continue;
    }
    table.set(spec.local.name, { source, imported: "*", kind: "namespace" });
  }
}

/** One entry per value-import local. The last declaration wins when a local is repeated. */
export function buildImportTable(program: Program): Map<string, ImportBinding> {
  const table = new Map<string, ImportBinding>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    if (isTypeOnly(statement.importKind)) continue;
    addSpecifiers(statement, table);
  }
  return table;
}
