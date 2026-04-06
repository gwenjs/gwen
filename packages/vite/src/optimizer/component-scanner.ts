/**
 * @file Scans TypeScript source files for `defineComponent(...)` calls and
 * populates a {@link ComponentManifest} with build-time metadata.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { walk } from 'oxc-walker';
import type {
  VariableDeclarator,
  CallExpression,
  ObjectExpression,
  StringLiteral,
  NumericLiteral,
  StaticMemberExpression,
  IdentifierName,
} from 'oxc-parser';
import {
  parseSource,
  isCallTo,
  getCallArgs,
  getObjectProperties,
  getPropertyKeyName,
} from '../oxc/index.js';
import type { ComponentManifest } from './component-manifest.js';
import type { ComponentEntry, ComponentFieldMeta } from './types.js';

// ─── ComponentScanner ────────────────────────────────────────────────────────

/**
 * Scans TypeScript source files for `defineComponent(...)` calls and
 * populates a ComponentManifest with build-time metadata.
 *
 * @example
 * ```ts
 * const scanner = new ComponentScanner(manifest)
 * scanner.scanFiles(['/project/src/components/position.ts'])
 * ```
 */
export class ComponentScanner {
  constructor(private readonly manifest: ComponentManifest) {}

  /**
   * Scan an array of absolute file paths and register all found `defineComponent` calls.
   * Reads files concurrently via `Promise.allSettled` to avoid blocking the event loop.
   * `allSettled` silently skips unreadable files (permissions, concurrent deletion), matching
   * the behaviour of the former synchronous try/catch loop.
   * After scanning, assigns fallback numeric IDs to components without explicit `_typeId`.
   *
   * @param files - Array of absolute file paths to scan.
   * @returns A promise that resolves when all files have been scanned.
   */
  async scanFiles(files: string[]): Promise<void> {
    await Promise.allSettled(
      files.map(async (file) => {
        const code = await readFile(file, 'utf-8');
        this.scanSource(code, file);
      }),
    );
    this._assignFallbackIds();
  }

  /**
   * Scan a single source string and register found `defineComponent` calls.
   * Does NOT assign fallback IDs — call scanFiles() or _assignFallbackIds() after.
   *
   * @param source   - TypeScript source code.
   * @param filename - Absolute path (stored as `importPath` in ComponentEntry).
   */
  scanSource(source: string, filename: string): void {
    if (!source.includes('defineComponent')) return;
    const parsed = parseSource(filename, source);
    if (!parsed) return;

    walk(parsed.program, {
      enter: (node) => {
        if (node.type !== 'VariableDeclarator') return;
        const decl = node as VariableDeclarator;
        const { id, init } = decl;
        if (id.type !== 'Identifier') return;
        if (!init || !isCallTo(init, 'defineComponent')) return;

        const exportName = (id as IdentifierName).name;
        const args = getCallArgs(init as CallExpression);
        if (args.length === 0) return;
        const configArg = args[0];
        if (configArg.type !== 'ObjectExpression') return;

        const entry = this._extractEntry(configArg as ObjectExpression, exportName, filename);
        if (entry) this.manifest.register(entry);
      },
    });
  }

  /**
   * Extract a ComponentEntry from a `defineComponent({...})` config object.
   *
   * @param configObj  - The ObjectExpression passed to `defineComponent`.
   * @param exportName - The variable name this component is assigned to.
   * @param importPath - The source file path.
   * @returns A populated ComponentEntry, or `null` if required fields are missing.
   */
  private _extractEntry(
    configObj: ObjectExpression,
    exportName: string,
    importPath: string,
  ): ComponentEntry | null {
    let name: string | null = null;
    let typeId: number | null = null;
    let schema: Record<string, string> | null = null;

    for (const prop of getObjectProperties(configObj)) {
      const key = getPropertyKeyName(prop);
      if (!key) continue;
      const { value } = prop;

      switch (key) {
        case 'name':
          if (value.type === 'Literal' && typeof (value as StringLiteral).value === 'string') {
            name = (value as StringLiteral).value;
          }
          break;
        case '_typeId':
          if (value.type === 'Literal' && typeof (value as NumericLiteral).value === 'number') {
            typeId = (value as NumericLiteral).value;
          }
          break;
        case 'schema':
          if (value.type === 'ObjectExpression') {
            schema = this._extractSchema(value as ObjectExpression);
          }
          break;
      }
    }

    if (!name || !schema) return null;

    const fields = this._buildFields(schema);
    return {
      name,
      typeId: typeId ?? -1,
      byteSize: fields.length * 4,
      f32Stride: fields.length,
      fields,
      importPath,
      exportName,
    };
  }

  /**
   * Extract schema field types from `{ x: Types.f32, y: Types.f32 }`.
   * Supports `Types.f32` (StaticMemberExpression) and `'f32'` string literal.
   *
   * @param schemaObj - The ObjectExpression from the schema property.
   * @returns A map of field name to type string.
   */
  private _extractSchema(schemaObj: ObjectExpression): Record<string, string> {
    const result: Record<string, string> = {};

    for (const prop of getObjectProperties(schemaObj)) {
      const key = getPropertyKeyName(prop);
      if (!key) continue;
      const { value } = prop;

      // Types.f32 → StaticMemberExpression (type: 'MemberExpression', computed: false)
      if (value.type === 'MemberExpression') {
        const mem = value as StaticMemberExpression;
        if (!mem.computed && mem.object.type === 'Identifier') {
          const objName = (mem.object as IdentifierName).name;
          if (objName === 'Types') {
            result[key] = mem.property.name;
          }
        }
        continue;
      }

      // String literal fallback: { x: 'f32' }
      if (value.type === 'Literal' && typeof (value as StringLiteral).value === 'string') {
        result[key] = (value as StringLiteral).value;
      }
    }

    return result;
  }

  /**
   * Build an ordered array of field descriptors with cumulative byte offsets.
   * Each field occupies 4 bytes (Float32).
   *
   * @param schema - Map of field name to type string.
   * @returns Ordered array of ComponentFieldMeta.
   */
  private _buildFields(schema: Record<string, string>): ReadonlyArray<ComponentFieldMeta> {
    return Object.entries(schema).map(([fieldName, type], i) => ({
      name: fieldName,
      type,
      byteOffset: i * 4,
    }));
  }

  /**
   * Assign stable numeric IDs to components that were registered without an explicit `_typeId`.
   * IDs are assigned in alphabetical order, starting after the highest explicit ID.
   * After assignment, the entry is re-registered with the new ID.
   */
  private _assignFallbackIds(): void {
    const all = [...this.manifest.entries()];
    const explicit = all.filter((e) => e.typeId !== -1);
    const needsId = all.filter((e) => e.typeId === -1);
    if (needsId.length === 0) return;

    const maxExplicit = explicit.length > 0 ? Math.max(...explicit.map((e) => e.typeId)) : 0;
    const sorted = [...needsId].sort((a, b) => a.name.localeCompare(b.name));
    let nextId = maxExplicit + 1;
    for (const entry of sorted) {
      (entry as { typeId: number }).typeId = nextId++;
      this.manifest.register(entry);
    }
  }
}

// ─── findComponentFiles ───────────────────────────────────────────────────────

/**
 * Recursively find all `.ts` and `.tsx` source files in a directory,
 * excluding test files (`*.test.ts`, `*.test.tsx`) and type declarations (`*.d.ts`).
 *
 * @param dir - The directory to search in.
 * @returns Array of absolute file paths.
 *
 * @example
 * ```ts
 * const files = findComponentFiles('/project/src')
 * // ['/project/src/components/position.ts', ...]
 * ```
 */
export function findComponentFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      result.push(...findComponentFiles(full));
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx') &&
      !entry.endsWith('.d.ts')
    ) {
      result.push(full);
    }
  }
  return result;
}
