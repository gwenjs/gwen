import type { Plugin } from 'vite';
import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';
import type {
  Program,
  Statement,
  ImportDeclaration,
  ImportSpecifier,
  ModuleExportName,
  IdentifierName,
  ObjectExpression,
  ObjectProperty,
  StringLiteral,
} from 'oxc-parser';
import { walk } from 'oxc-walker';

const CORE_IMPORT = '@gwenjs/core';

export interface GwenTransformOptions {
  /** Enable compile-time transforms for defineComponent schemas. */
  compileComponents?: boolean;
  /** Enable compile-time transforms for defineSystem/query descriptors. */
  compileSystems?: boolean;
  /** Enable optional auto-import rewriting for core GWEN helpers. */
  autoImports?: boolean;
  /** Optional include filter. Defaults to JS/TS source files. */
  include?: (id: string) => boolean;
  /** Optional exclude filter. Defaults to node_modules and virtual modules. */
  exclude?: (id: string) => boolean;
}

function normalizeId(id: string): string {
  return id.replace(/\\/g, '/');
}

function defaultInclude(id: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(id);
}

function defaultExclude(id: string): boolean {
  return id.includes('/node_modules/') || id.startsWith('\0') || id.includes('/.vite/');
}

/**
 * RFC-008 transform plugin — AST-based implementation using oxc-parser.
 *
 * Features:
 * - `autoImports`: inject missing `@gwenjs/core` named imports
 * - `compileSystems`: rewrite `query: [...]` → `query: [...] as const`
 * - `compileComponents`: rewrite `schema: {...}` → `schema: {...} as const`
 *
 * Uses oxc-parser for accurate AST (respects comments, strings, template literals).
 * Uses magic-string for position-based mutations with proper sourcemaps.
 */
export function gwenTransform(options: GwenTransformOptions = {}): Plugin {
  const include = options.include ?? defaultInclude;
  const exclude = options.exclude ?? defaultExclude;

  return {
    name: 'gwen-transform',
    enforce: 'pre',

    transform(code, id) {
      const normalized = normalizeId(id);
      if (exclude(normalized) || !include(normalized)) return null;

      const needsAutoImports =
        options.autoImports &&
        (/\bdefineComponent\s*\(/.test(code) ||
          /\bdefineSystem\s*\(/.test(code) ||
          /\bTypes\s*\./.test(code));

      const needsQueryTransform = options.compileSystems && /\bquery\s*:/.test(code);
      const needsSchemaTransform = options.compileComponents && /\bschema\s*:/.test(code);

      if (!needsAutoImports && !needsQueryTransform && !needsSchemaTransform) {
        return null;
      }

      let program: Program;
      try {
        const result = parseSync(id, code);
        if (result.errors && result.errors.length > 0) {
          const fatal = result.errors.filter((e) => e.severity === 'Error');
          if (fatal.length > 0) return null;
          // Non-fatal diagnostics — proceed but warn the developer.
          for (const e of result.errors) {
            this.warn(`[gwen-transform] Parse diagnostic in ${id}: ${e.message}`);
          }
        }
        program = result.program as Program;
      } catch {
        return null;
      }

      const s = new MagicString(code);

      if (needsAutoImports) {
        applyAutoImports(program, code, s);
      }

      if (needsQueryTransform || needsSchemaTransform) {
        applyAsConstTransforms(program, s, {
          query: !!needsQueryTransform,
          schema: !!needsSchemaTransform,
        });
      }

      if (!s.hasChanged()) return null;

      return {
        code: s.toString(),
        map: s.generateMap({ hires: true, source: id, includeContent: true }),
      };
    },
  };
}

// ─── Auto-imports ─────────────────────────────────────────────────────────────

/**
 * Inject missing `@gwenjs/core` named imports into the source via AST.
 *
 * @param program - Parsed oxc-parser AST program node.
 * @param code    - Original source string (for regex pre-screening).
 * @param s       - MagicString instance to mutate.
 */
function applyAutoImports(program: Program, code: string, s: MagicString): void {
  const needed = {
    defineComponent: /\bdefineComponent\s*\(/.test(code),
    defineSystem: /\bdefineSystem\s*\(/.test(code),
    Types: /\bTypes\s*\./.test(code),
  };

  const specifiers = (Object.keys(needed) as (keyof typeof needed)[]).filter((k) => needed[k]);
  if (specifiers.length === 0) return;

  // Program.body is Array<Directive | Statement>.  Directives have
  // type: "ExpressionStatement" so they will not be matched here.
  const body = program.body as unknown as Statement[];

  const coreImportNode = body.find(
    (node) =>
      node.type === 'ImportDeclaration' &&
      (node as ImportDeclaration).source.value === CORE_IMPORT &&
      (node as ImportDeclaration).importKind !== 'type',
  );

  if (coreImportNode) {
    const coreImport = coreImportNode as ImportDeclaration;
    const existing: string[] = coreImport.specifiers
      .filter((sp): sp is ImportSpecifier => sp.type === 'ImportSpecifier')
      .map((sp) => {
        const imported = sp.imported as ModuleExportName;
        return imported.type === 'Identifier'
          ? (imported as IdentifierName).name
          : (imported as { value: string }).value;
      })
      .filter((name): name is string => Boolean(name));

    const missing = specifiers.filter((name) => !existing.includes(name));
    if (missing.length === 0) return;

    const namedSpecs = coreImport.specifiers.filter(
      (sp): sp is ImportSpecifier => sp.type === 'ImportSpecifier',
    );

    if (namedSpecs.length > 0) {
      const lastSpec = namedSpecs[namedSpecs.length - 1]!;
      s.appendLeft(lastSpec.end, `, ${missing.join(', ')}`);
    } else {
      s.appendLeft(coreImport.end, `\nimport { ${missing.join(', ')} } from '${CORE_IMPORT}';`);
    }
    return;
  }

  const imports = body.filter((node) => node.type === 'ImportDeclaration');
  const insertLine = `import { ${specifiers.join(', ')} } from '${CORE_IMPORT}';\n`;

  if (imports.length > 0) {
    const lastImport = imports[imports.length - 1]!;
    s.appendLeft(lastImport.end, '\n' + insertLine.trimEnd());
  } else {
    s.prepend(insertLine);
  }
}

// ─── as const transforms ──────────────────────────────────────────────────────

interface AsConstOptions {
  /** Whether to add `as const` to `query: [...]` array expressions. */
  query: boolean;
  /** Whether to add `as const` to `schema: {...}` object expressions. */
  schema: boolean;
}

/**
 * Walk the AST and append ` as const` after qualifying `query` and `schema`
 * property values.
 *
 * @param program - Parsed oxc-parser AST program node.
 * @param s       - MagicString instance to mutate.
 * @param opts    - Which property keys to transform.
 */
function applyAsConstTransforms(program: Program, s: MagicString, opts: AsConstOptions): void {
  const insertPositions = new Set<number>();

  walk(program, {
    enter(node) {
      if (node.type !== 'ObjectExpression') return;
      const objNode = node as ObjectExpression;

      for (const prop of objNode.properties) {
        if (prop.type !== 'Property') continue;
        const p = prop as ObjectProperty;

        const key = p.key;
        const value = p.value;

        const keyName: string | null =
          key.type === 'Identifier'
            ? (key as IdentifierName).name
            : key.type === 'Literal'
              ? (() => {
                  const v = (key as StringLiteral).value;
                  return typeof v === 'string' ? v : null;
                })()
              : null;

        if (!keyName) continue;
        if (value.type === 'TSAsExpression') continue;

        if (opts.query && keyName === 'query' && value.type === 'ArrayExpression') {
          insertPositions.add(value.end);
        }

        if (opts.schema && keyName === 'schema' && value.type === 'ObjectExpression') {
          insertPositions.add(value.end);
        }
      }
    },
  });

  // Process in reverse order to avoid invalidating earlier positions.
  const sorted = [...insertPositions].sort((a, b) => b - a);
  for (const pos of sorted) {
    s.appendLeft(pos, ' as const');
  }
}
