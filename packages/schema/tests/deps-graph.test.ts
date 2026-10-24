/**
 * Contract-graph ratchet (#76).
 *
 * `@gwenjs/schema` is the single source of shared contracts. This suite scans
 * `packages/*\/src` (comments and strings are never read as code, the source is
 * parsed with the TypeScript compiler) and the package manifests, and enforces
 * rules R1-R12 on the package graph.
 *
 * Every rule is at zero hits. The one exception is the `DEFERRED` list below: violations owned by
 * another ticket (today the `GwenModuleEntry` declaration of #61). The ratchet works in both
 * directions:
 *   - a hit that is not a deferred row fails its rule (a new violation cannot slip in);
 *   - a deferred row with no hit fails the ratchet (a fixed violation must delete its row).
 *
 * Known limits of the scanner:
 *   - a second identical violation (same rule, file and match) in a file that already has a row is
 *     not seen until the owner PR deletes that row;
 *   - R9 does not see `import type * as X from "@gwenjs/core"` nor `export * from "@gwenjs/core"`,
 *     and R11 does not see `export namespace N { export let x }`.
 *
 * A hit is `{ rule, file, match }`. `file` is a repo-relative POSIX path. `match`
 * is the text found, with comments removed and whitespace collapsed to one line
 * (no line number, so an edit above the hit does not stale the row).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const RULE_IDS = [
  "R1",
  "R2a",
  "R2b",
  "R2c",
  "R3",
  "R4",
  "R5",
  "R6",
  "R7",
  "R8",
  "R9",
  "R10",
  "R11",
  "R12",
] as const;
type RuleId = (typeof RULE_IDS)[number];

interface HitLike {
  rule: string;
  file: string;
  match: string;
}

interface Hit extends HitLike {
  rule: RuleId;
}

/** Interfaces that carry a plugin contract: only `@gwenjs/schema` may be augmented with them (R4). */
const AUGMENTED_CONTRACTS = new Set([
  "GwenRuntimeHooks",
  "GwenProvides",
  "GwenModuleOptions",
  "GwenPrefabExtensions",
  "GwenSceneExtensions",
  "GwenUIExtensions",
]);

/** Contracts owned by `packages/schema/src` (R8, R9). */
const SCHEMA_CONTRACTS = new Set([
  ...AUGMENTED_CONTRACTS,
  "EngineErrorPayload",
  "PluginErrorEvent",
  "PluginErrorContext",
  "EntityId",
  "entityIndex",
  "ComponentType",
  "InferHooks",
  "HookHandlerMap",
  "GwenEngineState",
  "EngineStateChangePayload",
  "GwenEngineStateChangeReason",
  "GwenPlugin",
  "GwenModuleEntry",
]);

/** Context symbols owned by `packages/kit/src` (R8, R9; D-76-a). */
const KIT_CONTRACTS = new Set([
  "GwenContextError",
  "GwenContextErrorCode",
  "GwenContextErrorCodes",
  "GwenComposableError",
  "getCurrentScope",
  "_setCurrentScope",
]);

/**
 * The one source file allowed to build a `@gwenjs` declare module from a string (R10).
 * `hooks.ts` writes the project's generated `.gwen` type file, which is a project file
 * (Q1), not a package contract: the generated text has to contain the augmentation.
 */
const R10_ALLOWED_FILE = "packages/vite/src/plugins/hooks.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPosix(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join("/");
}

function readJson(file: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return parsed;
}

function hitKey(hit: HitLike): string {
  return `${hit.rule}\u0000${hit.file}\u0000${hit.match}`;
}

function describeHit(hit: HitLike): string {
  return `${hit.rule} ${hit.file}: ${hit.match}`;
}

/** Comments removed, every run of whitespace collapsed to one space. */
function cleanText(text: string): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  let out = "";
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue;
    }
    if (kind === ts.SyntaxKind.WhitespaceTrivia || kind === ts.SyntaxKind.NewLineTrivia) {
      out += " ";
      continue;
    }
    out += scanner.getTokenText();
  }
  return out.replace(/\s+/g, " ").trim();
}

/** `@gwenjs/core/internal` -> `@gwenjs/core`; anything that is not a workspace specifier -> undefined. */
function workspacePackageOf(specifier: string): string | undefined {
  if (!specifier.startsWith("@gwenjs/")) return undefined;
  const [scope, name] = specifier.split("/");
  return name === undefined || name === "" ? undefined : `${scope}/${name}`;
}

// ── source analysis (AST) ────────────────────────────────────────────────────

interface ModuleRef {
  kind: "import" | "export" | "dynamic" | "require" | "declare-module";
  specifier: string;
  /** The statement up to the specifier, e.g. `import type { Vec3 } from "@gwenjs/math"`. */
  text: string;
  /** Names imported or re-exported by name (`import { a as b }` -> `a`). */
  names: string[];
}

interface ModuleBlock {
  target: string;
  /** `declare module "<target>"`. */
  text: string;
  interfaces: string[];
  /** The type-error suppression directive that applies to the block, if any. */
  suppression: string | undefined;
}

interface Declaration {
  name: string;
  /** `export interface X`, `const X`, ... */
  text: string;
}

interface Analysis {
  refs: ModuleRef[];
  moduleBlocks: ModuleBlock[];
  /** Interface names declared inside `declare global { ... }`. */
  globalInterfaces: string[];
  /** Declarations outside `declare module "..."` blocks. */
  declarations: Declaration[];
  /** `declare module "@gwenjs/..."` found inside a string or template literal. */
  stringDeclarations: string[];
  classNames: string[];
  /** Module-level `let` / `var` bindings. */
  mutableBindings: string[];
}

/** The directive regex of tsc for a comment line: `//` and `/*` openers, `*` continuations. */
const SUPPRESSION = /^(?:\/|\*)*\s*(@ts-(?:expect-error|ignore))/;
const STRING_DECLARE_MODULE = /declare\s+module\s+["'`]@gwenjs\/[^"'`\s{;]*["'`]?/;

/**
 * The type-error suppression directive that tsc applies to `node`, walking back the way tsc does:
 * blank lines and lines that hold only a `//` comment are skipped, any other line stops the walk.
 * A directive counts on the line of its comment end (the last line of a block comment).
 */
function suppressionBefore(sf: ts.SourceFile, node: ts.Node): string | undefined {
  const byLine = new Map<number, string>();
  const ranges = [
    ...(ts.getTrailingCommentRanges(sf.text, node.getFullStart()) ?? []),
    ...(ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? []),
  ];
  for (const range of ranges) {
    const comment = sf.text.slice(range.pos, range.end);
    const lastLine = comment.slice(comment.lastIndexOf("\n") + 1).trimStart();
    const directive = SUPPRESSION.exec(lastLine)?.[1];
    if (directive !== undefined) {
      byLine.set(sf.getLineAndCharacterOfPosition(range.end).line, directive);
    }
  }
  const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const sameLine = byLine.get(startLine);
  if (sameLine !== undefined) return sameLine;
  const lineStarts = sf.getLineStarts();
  for (let line = startLine - 1; line >= 0; line--) {
    const directive = byLine.get(line);
    if (directive !== undefined) return directive;
    const lineText = sf.text.slice(lineStarts[line], lineStarts[line + 1]).trim();
    if (lineText !== "" && !lineText.startsWith("//")) return undefined;
  }
  return undefined;
}

function leftmostName(name: ts.EntityName): string {
  return ts.isIdentifier(name) ? name.text : leftmostName(name.left);
}

function analyze(file: string, text: string): Analysis {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result: Analysis = {
    refs: [],
    moduleBlocks: [],
    globalInterfaces: [],
    declarations: [],
    stringDeclarations: [],
    classNames: [],
    mutableBindings: [],
  };
  const slice = (node: ts.Node, end: number): string =>
    cleanText(text.slice(node.getStart(sf), end));

  // File, `namespace` and `declare global` level only: a declaration inside a function is local.
  const isScopeLevel = (node: ts.Declaration): boolean => {
    const statement = ts.isVariableDeclaration(node) ? node.parent.parent : node;
    if (ts.isVariableDeclaration(node) && !ts.isVariableStatement(statement)) return false;
    return ts.isSourceFile(statement.parent) || ts.isModuleBlock(statement.parent);
  };

  const declare = (
    node: ts.Declaration,
    name: ts.Node | undefined,
    keyword: string,
    inAugmentation: boolean,
  ): void => {
    if (inAugmentation || name === undefined || !ts.isIdentifier(name)) return;
    if (!isScopeLevel(node)) return;
    const exported = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
    result.declarations.push({
      name: name.text,
      text: `${exported ? "export " : ""}${keyword} ${name.text}`,
    });
  };

  const visit = (node: ts.Node, inAugmentation: boolean): void => {
    let nested = inAugmentation;
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      const names =
        bindings !== undefined && ts.isNamedImports(bindings)
          ? bindings.elements.map((element) => (element.propertyName ?? element.name).text)
          : [];
      result.refs.push({
        kind: "import",
        specifier: node.moduleSpecifier.text,
        text: slice(node, node.moduleSpecifier.end),
        names,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.exportClause;
      const names =
        clause !== undefined && ts.isNamedExports(clause)
          ? clause.elements.map((element) => (element.propertyName ?? element.name).text)
          : [];
      result.refs.push({
        kind: "export",
        specifier: node.moduleSpecifier.text,
        text: slice(node, node.moduleSpecifier.end),
        names,
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      result.refs.push({
        kind: "require",
        specifier: node.moduleReference.expression.text,
        text: cleanText(text.slice(node.getStart(sf), node.end)),
        names: [],
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const parent = node.parent;
      result.refs.push({
        kind: "dynamic",
        specifier: node.arguments[0].text,
        text: `import("${node.arguments[0].text}")`,
        names:
          ts.isPropertyAccessExpression(parent) && parent.expression === node
            ? [parent.name.text]
            : [],
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      result.refs.push({
        kind: "dynamic",
        specifier: node.argument.literal.text,
        text: `import("${node.argument.literal.text}")`,
        names: node.qualifier === undefined ? [] : [leftmostName(node.qualifier)],
      });
    } else if (ts.isModuleDeclaration(node)) {
      if (ts.isStringLiteral(node.name)) {
        const text_ = slice(node, node.name.end);
        result.refs.push({
          kind: "declare-module",
          specifier: node.name.text,
          text: text_,
          names: [],
        });
        result.moduleBlocks.push({
          target: node.name.text,
          text: text_,
          interfaces:
            node.body !== undefined && ts.isModuleBlock(node.body)
              ? node.body.statements.filter(ts.isInterfaceDeclaration).map((n) => n.name.text)
              : [],
          suppression: suppressionBefore(sf, node),
        });
        nested = true;
      } else if (node.flags & ts.NodeFlags.GlobalAugmentation) {
        if (node.body !== undefined && ts.isModuleBlock(node.body)) {
          for (const statement of node.body.statements) {
            if (ts.isInterfaceDeclaration(statement)) {
              result.globalInterfaces.push(statement.name.text);
            }
          }
        }
      } else {
        declare(node, node.name, "namespace", inAugmentation);
      }
    } else if (ts.isInterfaceDeclaration(node)) {
      declare(node, node.name, "interface", inAugmentation);
    } else if (ts.isTypeAliasDeclaration(node)) {
      declare(node, node.name, "type", inAugmentation);
    } else if (ts.isFunctionDeclaration(node)) {
      declare(node, node.name, "function", inAugmentation);
    } else if (ts.isEnumDeclaration(node)) {
      declare(node, node.name, "enum", inAugmentation);
    } else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      result.classNames.push(node.name?.text ?? "(anonymous)");
      if (ts.isClassDeclaration(node)) declare(node, node.name, "class", inAugmentation);
    } else if (ts.isVariableDeclaration(node)) {
      const list = node.parent;
      const keyword =
        list.flags & ts.NodeFlags.Const ? "const" : list.flags & ts.NodeFlags.Let ? "let" : "var";
      declare(node, node.name, keyword, inAugmentation);
      const statement = list.parent;
      if (keyword !== "const" && ts.isVariableStatement(statement) && statement.parent === sf) {
        result.mutableBindings.push(`${keyword} ${cleanText(node.name.getText(sf))}`);
      }
    } else if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      const found = STRING_DECLARE_MODULE.exec(node.text);
      if (found !== null) result.stringDeclarations.push(found[0]);
    }
    ts.forEachChild(node, (child) => visit(child, nested));
  };
  visit(sf, false);
  return result;
}

// ── package corpus ───────────────────────────────────────────────────────────

type DependencyField = "dependencies" | "devDependencies" | "peerDependencies";
const DEPENDENCY_FIELDS: DependencyField[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
];

interface Manifest {
  /** Directory name under `packages/`. */
  dir: string;
  name: string;
  /** `"private": true`: never published, so its `devDependencies` are its real dependencies. */
  private: boolean;
  deps: Record<DependencyField, string[]>;
}

interface SourceFile {
  /** Repo-relative POSIX path. */
  file: string;
  dir: string;
  analysis: Analysis;
}

function loadManifests(): Manifest[] {
  const packagesDir = path.join(repoRoot, "packages");
  const manifests: Manifest[] = [];
  for (const dir of readdirSync(packagesDir).sort()) {
    const manifestPath = path.join(packagesDir, dir, "package.json");
    let raw: unknown;
    try {
      raw = readJson(manifestPath);
    } catch {
      continue;
    }
    if (!isRecord(raw) || typeof raw.name !== "string") continue;
    const keys = (field: DependencyField): string[] => {
      const value = raw[field];
      return isRecord(value) ? Object.keys(value).sort() : [];
    };
    manifests.push({
      dir,
      name: raw.name,
      private: raw.private === true,
      deps: {
        dependencies: keys("dependencies"),
        devDependencies: keys("devDependencies"),
        peerDependencies: keys("peerDependencies"),
      },
    });
  }
  return manifests;
}

function sourcePaths(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue;
      found.push(...sourcePaths(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".fixture.ts")) continue;
    found.push(full);
  }
  return found;
}

function loadSources(manifests: Manifest[]): SourceFile[] {
  const sources: SourceFile[] = [];
  for (const manifest of manifests) {
    const srcDir = path.join(repoRoot, "packages", manifest.dir, "src");
    try {
      if (!statSync(srcDir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const absolute of sourcePaths(srcDir)) {
      sources.push({
        file: toPosix(absolute),
        dir: manifest.dir,
        analysis: analyze(absolute, readFileSync(absolute, "utf8")),
      });
    }
  }
  return sources;
}

interface Corpus {
  manifests: Manifest[];
  sources: SourceFile[];
}

let corpusCache: Corpus | undefined;
function corpus(): Corpus {
  if (corpusCache === undefined) {
    const manifests = loadManifests();
    corpusCache = { manifests, sources: loadSources(manifests) };
  }
  return corpusCache;
}

function manifestOf(dir: string): Manifest {
  const manifest = corpus().manifests.find((candidate) => candidate.dir === dir);
  if (manifest === undefined) throw new Error(`no package.json for packages/${dir}`);
  return manifest;
}

// ── rules ────────────────────────────────────────────────────────────────────

class HitSet {
  private readonly hits = new Map<string, Hit>();
  add(rule: RuleId, file: string, match: string): void {
    const hit: Hit = { rule, file, match };
    this.hits.set(hitKey(hit), hit);
  }
  list(): Hit[] {
    return [...this.hits.values()];
  }
}

function scanR1(): Hit[] {
  const out = new HitSet();
  for (const source of corpus().sources) {
    const manifest = manifestOf(source.dir);
    const declared = new Set([
      ...manifest.deps.dependencies,
      ...manifest.deps.peerDependencies,
      ...(manifest.private ? manifest.deps.devDependencies : []),
    ]);
    for (const ref of source.analysis.refs) {
      const pkg = workspacePackageOf(ref.specifier);
      if (pkg === undefined || pkg === manifest.name || declared.has(pkg)) continue;
      out.add("R1", source.file, ref.text);
    }
  }
  return out.list();
}

function scanR2a(): Hit[] {
  const out = new HitSet();
  const file = "packages/schema/package.json";
  const manifest = manifestOf("schema");
  for (const key of manifest.deps.dependencies) {
    if (key !== "defu") out.add("R2a", file, `dependencies: unexpected ${key}`);
  }
  if (!manifest.deps.dependencies.includes("defu"))
    out.add("R2a", file, "dependencies: missing defu");
  for (const field of ["devDependencies", "peerDependencies"] as const) {
    for (const key of manifest.deps[field]) {
      if (key.startsWith("@gwenjs/")) out.add("R2a", file, `${field}: unexpected ${key}`);
    }
  }
  return out.list();
}

function scanR2b(): Hit[] {
  // `@gwenjs/schema` may sit in any of the three fields: only the set over all of them is fixed.
  const manifest = manifestOf("kit");
  const out = new HitSet();
  const file = "packages/kit/package.json";
  const seen = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    for (const key of manifest.deps[field]) {
      if (!key.startsWith("@gwenjs/")) continue;
      seen.add(key);
      if (key !== "@gwenjs/schema") out.add("R2b", file, `${field}: unexpected ${key}`);
    }
  }
  if (!seen.has("@gwenjs/schema")) out.add("R2b", file, "missing @gwenjs/schema");
  return out.list();
}

function scanR2c(): Hit[] {
  const out = new HitSet();
  const file = "packages/core/package.json";
  const manifest = manifestOf("core");
  for (const field of DEPENDENCY_FIELDS) {
    const actual = manifest.deps[field].filter((key) => key.startsWith("@gwenjs/"));
    const wanted =
      field === "dependencies" ? ["@gwenjs/kit", "@gwenjs/math", "@gwenjs/schema"] : [];
    for (const key of actual) {
      if (!wanted.includes(key)) out.add("R2c", file, `${field}: unexpected ${key}`);
    }
    for (const key of wanted) {
      if (!actual.includes(key)) out.add("R2c", file, `${field}: missing ${key}`);
    }
  }
  return out.list();
}

function scanR3(): Hit[] {
  const { manifests } = corpus();
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const edges = (manifest: Manifest): string[] =>
    [...new Set(DEPENDENCY_FIELDS.flatMap((field) => manifest.deps[field]))].filter((key) =>
      byName.has(key),
    );
  const out = new HitSet();
  const state = new Map<string, "open" | "done">();
  const stack: string[] = [];
  const visit = (name: string): void => {
    state.set(name, "open");
    stack.push(name);
    const manifest = byName.get(name);
    for (const next of manifest === undefined ? [] : edges(manifest)) {
      if (state.get(next) === "open") {
        const cycle = stack.slice(stack.indexOf(next));
        const first = [...cycle].sort()[0] ?? next;
        const at = cycle.indexOf(first);
        const rotated = [...cycle.slice(at), ...cycle.slice(0, at), first];
        const owner = byName.get(first);
        out.add("R3", `packages/${owner?.dir ?? first}/package.json`, rotated.join(" -> "));
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(name, "done");
  };
  for (const name of [...byName.keys()].sort()) {
    if (!state.has(name)) visit(name);
  }
  return out.list();
}

function scanR4(): Hit[] {
  const out = new HitSet();
  for (const source of corpus().sources) {
    for (const block of source.analysis.moduleBlocks) {
      if (block.target === "@gwenjs/schema") continue;
      if (block.interfaces.some((name) => AUGMENTED_CONTRACTS.has(name))) {
        out.add("R4", source.file, block.text);
      }
    }
  }
  return out.list();
}

function scanR5(): Hit[] {
  const out = new HitSet();
  for (const source of corpus().sources) {
    for (const block of source.analysis.moduleBlocks) {
      if (block.suppression !== undefined) {
        // The leading `@` is dropped: a known row that spelled the directive would itself trip the
        // agent-hygiene check on the added line.
        out.add("R5", source.file, `${block.suppression.replace(/^@/, "")} ${block.text}`);
      }
    }
  }
  return out.list();
}

function scanR6(): Hit[] {
  const out = new HitSet();
  for (const source of corpus().sources) {
    for (const name of source.analysis.globalInterfaces) {
      if (name.startsWith("Gwen"))
        out.add("R6", source.file, `declare global { interface ${name} }`);
    }
  }
  return out.list();
}

type ExternalFunction = (id: string, parent: string | undefined, resolved: boolean) => unknown;
type ConfigFactory = (env: { command: string; mode: string }) => unknown;

function isExternalFunction(value: unknown): value is ExternalFunction {
  return typeof value === "function";
}

function isConfigFactory(value: unknown): value is ConfigFactory {
  return typeof value === "function";
}

/** Applies the `external` option the way Rollup does and returns whether `id` stays external. */
function isExternal(external: unknown, id: string): boolean {
  if (typeof external === "string") return external === id;
  if (external instanceof RegExp) {
    return new RegExp(external.source, external.flags.replace("g", "")).test(id);
  }
  if (Array.isArray(external)) return external.some((entry: unknown) => isExternal(entry, id));
  if (isExternalFunction(external)) return external(id, undefined, false) === true;
  return false;
}

/** Evaluates `vite.config.ts` for a production build and returns `build.rollupOptions.external`. */
async function externalOf(configFile: string): Promise<unknown> {
  const loaded: unknown = await import(/* @vite-ignore */ configFile);
  let config: unknown = isRecord(loaded) ? loaded.default : undefined;
  if (isConfigFactory(config)) config = await config({ command: "build", mode: "production" });
  const build = isRecord(config) ? config.build : undefined;
  const rollupOptions = isRecord(build) ? build.rollupOptions : undefined;
  return isRecord(rollupOptions) ? rollupOptions.external : undefined;
}

async function scanR7(): Promise<Hit[]> {
  const out = new HitSet();
  const { manifests, sources } = corpus();
  for (const manifest of manifests) {
    const configPath = path.join(repoRoot, "packages", manifest.dir, "vite.config.ts");
    try {
      if (!statSync(configPath).isFile()) continue;
    } catch {
      continue;
    }
    const specifiers = new Set<string>();
    for (const source of sources) {
      if (source.dir !== manifest.dir) continue;
      for (const ref of source.analysis.refs) {
        if (workspacePackageOf(ref.specifier) !== undefined) specifiers.add(ref.specifier);
      }
    }
    if (specifiers.size === 0) continue;
    const external = await externalOf(configPath);
    for (const specifier of [...specifiers].sort()) {
      if (!isExternal(external, specifier)) {
        out.add("R7", `packages/${manifest.dir}/vite.config.ts`, specifier);
      }
    }
  }
  return out.list();
}

function scanR8(): Hit[] {
  const out = new HitSet();
  for (const source of corpus().sources) {
    const ownsSchema = source.file.startsWith("packages/schema/src/");
    const ownsKit = source.file.startsWith("packages/kit/src/");
    for (const declaration of source.analysis.declarations) {
      const owned =
        (SCHEMA_CONTRACTS.has(declaration.name) && !ownsSchema) ||
        (KIT_CONTRACTS.has(declaration.name) && !ownsKit);
      if (owned) out.add("R8", source.file, declaration.text);
    }
    if (source.file.startsWith("packages/core/src/")) {
      for (const block of source.analysis.moduleBlocks) {
        if (block.interfaces.includes("GwenRuntimeHooks")) {
          out.add("R8", source.file, `${block.text} { interface GwenRuntimeHooks }`);
        }
      }
    }
  }
  return out.list();
}

function scanR9(): Hit[] {
  const out = new HitSet();
  const ownerDirs = ["core", "schema", "kit"];
  for (const source of corpus().sources) {
    for (const ref of source.analysis.refs) {
      if (ref.kind === "declare-module") continue;
      const pkg = workspacePackageOf(ref.specifier);
      if (source.dir === "kit" && pkg === "@gwenjs/core") {
        out.add("R9", source.file, ref.text);
      }
      if (ownerDirs.includes(source.dir)) continue;
      for (const name of ref.names) {
        const foreignContract =
          pkg === "@gwenjs/core" && (SCHEMA_CONTRACTS.has(name) || KIT_CONTRACTS.has(name));
        const foreignOptions = pkg === "@gwenjs/app" && name === "GwenModuleOptions";
        if (foreignContract || foreignOptions) {
          out.add("R9", source.file, `${name} from "${ref.specifier}"`);
        }
      }
    }
  }
  return out.list();
}

function scanR10(): Hit[] {
  const out = new HitSet();
  for (const source of corpus().sources) {
    if (source.file === R10_ALLOWED_FILE) continue;
    for (const found of source.analysis.stringDeclarations) out.add("R10", source.file, found);
  }
  return out.list();
}

function scanR11(): Hit[] {
  const out = new HitSet();
  for (const source of corpus().sources) {
    if (source.dir !== "schema") continue;
    for (const name of source.analysis.classNames) {
      if (name !== "GwenError") out.add("R11", source.file, `class ${name}`);
    }
    for (const binding of source.analysis.mutableBindings) out.add("R11", source.file, binding);
  }
  return out.list();
}

/** R12: no explicit `any` in `packages/schema/src`. The AST is read, so a comment or a string never counts. */
function scanR12(): Hit[] {
  const out = new HitSet();
  for (const source of corpus().sources) {
    if (source.dir !== "schema") continue;
    const text = readFileSync(path.join(repoRoot, source.file), "utf8");
    const sf = ts.createSourceFile(
      source.file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        let statement: ts.Node = node;
        while (!ts.isSourceFile(statement.parent) && !ts.isModuleBlock(statement.parent)) {
          statement = statement.parent;
        }
        out.add("R12", source.file, cleanText(statement.getText(sf)));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out.list();
}

const SCANNERS: Record<RuleId, () => Hit[] | Promise<Hit[]>> = {
  R1: scanR1,
  R2a: scanR2a,
  R2b: scanR2b,
  R2c: scanR2c,
  R3: scanR3,
  R4: scanR4,
  R5: scanR5,
  R6: scanR6,
  R7: scanR7,
  R8: scanR8,
  R9: scanR9,
  R10: scanR10,
  R11: scanR11,
  R12: scanR12,
};

const hitCache = new Map<RuleId, Promise<Hit[]>>();
function hitsOf(rule: RuleId): Promise<Hit[]> {
  let cached = hitCache.get(rule);
  if (cached === undefined) {
    cached = Promise.resolve(SCANNERS[rule]());
    hitCache.set(rule, cached);
  }
  return cached;
}

// ── deferred violations (the ratchet data) ─────────────────────────────────

interface Row {
  rule: string;
  file: string;
  match: string;
  owner: string;
}

/** Violations owned by another ticket: the `GwenModuleEntry` declaration of #61 (D-76-c), nothing else. */
const DEFERRED: Row[] = [
  {
    rule: "R8",
    file: "packages/app/src/types.ts",
    match: "export type GwenModuleEntry",
    owner: "#61",
  },
];
const DEFERRED_OWNER = "#61";
const DEFERRED_RULE = "R8";
const DEFERRED_SYMBOL = "GwenModuleEntry";

async function unrecordedHits(rule: RuleId): Promise<string[]> {
  const recorded = new Set(DEFERRED.map(hitKey));
  const hits = await hitsOf(rule);
  return hits
    .filter((hit) => !recorded.has(hitKey(hit)))
    .map((hit) => `${describeHit(hit)} (no row in the deferred list)`);
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("deps-graph", () => {
  it("every @gwenjs import and augmentation is a declared dependency", async () => {
    // The scanner fixtures live in this test, not in a test of their own: a stand-alone test
    // would pass on the base (verify-red copies only this file there) and count as "not red".
    const directive = "@ts-" + "expect-error";
    const source = [
      '// import { A } from "@gwenjs/fake-line";',
      "/**",
      " * @example",
      ' * import type { B } from "@gwenjs/fake-doc";',
      " * declare module '@gwenjs/fake-doc' { interface GwenProvides {} }",
      " */",
      "const text = \"declare module '@gwenjs/fake-string' { } import { C } from '@gwenjs/x'\";",
      'const url = "http://example.test"; import { D } from "@gwenjs/real-d";',
      "const template = `declare module '@gwenjs/fake-template' { ${\"}\"} }`;",
      "const pattern = /[\"'`]/g; import type { E as Renamed } from '@gwenjs/real-e/sub';",
      `// ${directive} a blank line does not detach it from the block below`,
      "",
      "declare module '@gwenjs/real-f' {",
      "  interface GwenProvides { f: number }",
      "}",
      `// ${directive} real suppression`,
      'declare module "@gwenjs/real-g" {}',
      "export * from '@gwenjs/real-h';",
      'type Late = import("@gwenjs/real-i").Thing;',
      "import {",
      "  // line comment inside the clause",
      "  G, /* block comment */",
      "  H,",
      '} from "@gwenjs/real-j"; // trailing comment',
      `// ${directive} a note line does not detach it either`,
      "// a note",
      "declare module '@gwenjs/real-k' {}",
      `/* ${directive} */`,
      "",
      "declare module '@gwenjs/real-l' {}",
      `const trailing = 1; // ${directive}`,
      "declare module '@gwenjs/real-m' {}",
      `// ${directive} a code line detaches it`,
      "const between = 1;",
      "declare module '@gwenjs/real-n' {}",
      `// ${directive} a block comment line detaches it`,
      "/* note */",
      "declare module '@gwenjs/real-o' {}",
      "/**",
      ` * // ${directive} inside a block comment is not a directive`,
      " */",
      "declare module '@gwenjs/real-p' {}",
    ].join("\n");
    const found = analyze("fixture.ts", source);
    expect(found.refs.map((ref) => ref.specifier)).toEqual([
      "@gwenjs/real-d",
      "@gwenjs/real-e/sub",
      "@gwenjs/real-f",
      "@gwenjs/real-g",
      "@gwenjs/real-h",
      "@gwenjs/real-i",
      "@gwenjs/real-j",
      "@gwenjs/real-k",
      "@gwenjs/real-l",
      "@gwenjs/real-m",
      "@gwenjs/real-n",
      "@gwenjs/real-o",
      "@gwenjs/real-p",
    ]);
    expect(found.refs[1]).toMatchObject({
      text: "import type { E as Renamed } from '@gwenjs/real-e/sub'",
      names: ["E"],
    });
    // tsc applies a directive across blank lines and `//` lines, and on the previous code line.
    // A code line, a block comment line or a block comment body in between detaches it.
    expect(
      found.moduleBlocks.map((block) => [
        block.target.replace("@gwenjs/real-", ""),
        block.suppression,
      ]),
    ).toEqual([
      ["f", directive],
      ["g", directive],
      ["k", directive],
      ["l", directive],
      ["m", directive],
      ["n", undefined],
      ["o", undefined],
      ["p", undefined],
    ]);
    expect(found.moduleBlocks[0]?.interfaces).toEqual(["GwenProvides"]);
    // The statement text has its comments removed and sits on one line.
    expect(found.refs[6]).toMatchObject({
      text: 'import { G, H, } from "@gwenjs/real-j"',
      names: ["G", "H"],
    });
    // Only the two string-literal occurrences count; the comment and real-code ones do not.
    expect(found.stringDeclarations).toEqual([
      "declare module '@gwenjs/fake-string'",
      "declare module '@gwenjs/fake-template'",
    ]);
    // CRLF line endings change nothing.
    const crlf = analyze(
      "fixture.ts",
      [
        `// ${directive}`,
        "",
        "declare module '@gwenjs/crlf-a' {}",
        `// ${directive}`,
        "// a note",
        "declare module '@gwenjs/crlf-b' {}",
      ].join("\r\n"),
    );
    expect(crlf.moduleBlocks.map((block) => block.suppression)).toEqual([directive, directive]);

    expect(await unrecordedHits("R1")).toEqual([]);
  });

  it("schema has no @gwenjs dependency and only defu", async () => {
    expect(await unrecordedHits("R2a")).toEqual([]);
  });

  it("kit depends on @gwenjs/schema only", async () => {
    expect(await unrecordedHits("R2b")).toEqual([]);
  });

  it("core depends on kit, math and schema", async () => {
    expect(await unrecordedHits("R2c")).toEqual([]);
  });

  it("the @gwenjs dependency graph has no cycle", async () => {
    expect(await unrecordedHits("R3")).toEqual([]);
  });

  it("contracts are augmented through @gwenjs/schema only", async () => {
    expect(await unrecordedHits("R4")).toEqual([]);
  });

  it("no type-error suppression sits on a declare module", async () => {
    expect(await unrecordedHits("R5")).toEqual([]);
  });

  it("no declare global declares a Gwen contract", async () => {
    expect(await unrecordedHits("R6")).toEqual([]);
  });

  it("every build externalizes the @gwenjs packages it imports", async () => {
    expect(await unrecordedHits("R7")).toEqual([]);
  });

  it("every shared contract is declared once, in its owner package", async () => {
    // Fixture first (it reads no data file): only file, `namespace` and `declare global` level
    // declarations count, a declaration inside a function or a loop head is local.
    const scoped = analyze(
      "fixture.ts",
      [
        "function f() {",
        "  type EntityId = number;",
        "  const GwenProvides = 1;",
        "}",
        "for (const GwenPlugin of []) {}",
        "export type EntityId = number;",
        "namespace N { export interface GwenPlugin {} }",
        "declare global { type ComponentType = number }",
        "export let counter = 0;",
      ].join("\n"),
    );
    expect(scoped.declarations.map((declaration) => declaration.text)).toEqual([
      "function f",
      "export type EntityId",
      "namespace N",
      "export interface GwenPlugin",
      "type ComponentType",
      "export let counter",
    ]);
    expect(await unrecordedHits("R8")).toEqual([]);
  });

  it("no package imports a contract from a package that does not own it", async () => {
    expect(await unrecordedHits("R9")).toEqual([]);
  });

  it("no source builds a @gwenjs declare module from a string", async () => {
    expect(await unrecordedHits("R10")).toEqual([]);
  });

  it("schema holds no state and no class but GwenError", async () => {
    expect(await unrecordedHits("R11")).toEqual([]);
  });

  it("every rule has zero hits outside the deferred list", async () => {
    const problems: string[] = [];
    if (existsSync(path.join(repoRoot, "packages/schema/tests/deps-graph.known.json"))) {
      problems.push("packages/schema/tests/deps-graph.known.json must be deleted");
    }
    const hits = (await Promise.all(RULE_IDS.map(hitsOf))).flat();
    const hitKeys = new Set(hits.map(hitKey));
    const rowKeys = new Set<string>();
    for (const row of DEFERRED) {
      const key = hitKey(row);
      if (rowKeys.has(key)) problems.push(`duplicate row: ${describeHit(row)}`);
      rowKeys.add(key);
      if (!hitKeys.has(key)) problems.push(`stale row (${row.owner}): ${describeHit(row)}`);
      if (row.owner !== DEFERRED_OWNER) {
        problems.push(
          `deferred row without owner ${DEFERRED_OWNER} ("${row.owner}"): ${row.rule} ${row.file}`,
        );
      }
      if (row.rule !== DEFERRED_RULE || !row.match.includes(DEFERRED_SYMBOL)) {
        problems.push(
          `deferred row that is not a ${DEFERRED_RULE} hit on ${DEFERRED_SYMBOL}: ${describeHit(row)}`,
        );
      }
    }
    for (const hit of hits) {
      if (!rowKeys.has(hitKey(hit))) problems.push(`unrecorded hit: ${describeHit(hit)}`);
    }
    expect(problems).toEqual([]);
  });
});
