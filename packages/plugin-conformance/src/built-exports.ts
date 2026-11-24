import path from "node:path";
import ts from "typescript";
import { isRecord } from "./json.js";

/** Names a module file exports, split into values and types. */
export interface ModuleExports {
  readonly values: readonly string[];
  readonly types: readonly string[];
}

/** One subpath read from its built types file. */
export interface BuiltModuleFile extends ModuleExports {
  readonly file: string;
}

/** The types file a target declares: `types`, `types.import`, then `import`. */
export function declaredTypes(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (!isRecord(target)) return undefined;
  if (typeof target.types === "string") return target.types;
  if (isRecord(target.types) && typeof target.types.import === "string") return target.types.import;
  return typeof target.import === "string" ? target.import : undefined;
}

/** Names exported by `file`, split into values and types. `__`-prefixed names are skipped. */
export function exportNames(program: ts.Program, file: string): ModuleExports {
  const source = program.getSourceFile(file);
  const checker = program.getTypeChecker();
  const moduleSymbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);
  const values: string[] = [];
  const types: string[] = [];
  if (moduleSymbol === undefined) return { values, types };
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = symbol.getName();
    if (name.startsWith("__")) continue;
    const alias = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const isValue = (alias.flags & ts.SymbolFlags.Value) !== 0;
    const declaration = symbol.declarations?.[0];
    const typeOnly =
      (declaration !== undefined &&
        ts.isExportSpecifier(declaration) &&
        (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly)) ||
      (declaration !== undefined && ts.isExportDeclaration(declaration) && declaration.isTypeOnly);
    (typeOnly || !isValue ? types : values).push(name);
  }
  return { values: values.sort(), types: types.sort() };
}

/** Read the exports of every built subpath. */
export function readBuilt(
  root: string,
  files: ReadonlyMap<string, string>,
): Map<string, BuiltModuleFile> {
  const program = ts.createProgram({
    rootNames: [...new Set(files.values())],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowJs: true,
      skipLibCheck: true,
      noEmit: true,
      noLib: true,
      types: [],
      strict: false,
    },
  });
  const built = new Map<string, BuiltModuleFile>();
  for (const [subpath, file] of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    built.set(subpath, { ...exportNames(program, file), file: relative });
  }
  return built;
}
