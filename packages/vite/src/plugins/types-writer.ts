import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { GwenTypeTemplate } from '@gwenjs/kit';
import type { GwenViteOptions } from '../types.js';

/**
 * Writes type template files into `.gwen/types/` at build start.
 *
 * Each {@link GwenTypeTemplate} has a `filename` and a `getContents()` function.
 * The plugin only writes the file when the content has changed, avoiding
 * unnecessary TypeScript re-checks.
 *
 * @example
 * ```ts
 * gwenTypesPlugin({
 *   typeTemplates: [
 *     {
 *       filename: 'physics2d.d.ts',
 *       getContents: () => 'declare const gravity: number\n',
 *     },
 *   ],
 * })
 * ```
 */
export function gwenTypesPlugin(options: GwenViteOptions): Plugin {
  const templates = options.typeTemplates ?? [];
  let root = process.cwd();

  return {
    name: 'gwen:types',

    configResolved(config) {
      root = config.root;
    },

    buildStart() {
      writeTypeTemplates(root, options.gwenDir ?? '.gwen', templates);
    },
  };
}

/**
 * Writes each template's contents to `<root>/<gwenDir>/types/<filename>`.
 * Files are only overwritten when the content has changed.
 *
 * @param root - Project root directory.
 * @param gwenDir - Relative path to the GWEN output directory.
 * @param templates - Templates to write.
 */
function writeTypeTemplates(root: string, gwenDir: string, templates: GwenTypeTemplate[]): void {
  if (templates.length === 0) return;

  const dir = resolve(root, gwenDir, 'types');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  for (const template of templates) {
    const filePath = resolve(dir, template.filename);
    const content = template.getContents();
    writeIfChanged(filePath, content);
  }
}

/**
 * Writes `content` to `filePath` only when the existing content differs.
 *
 * @param filePath - Absolute path to the target file.
 * @param content - New file content.
 */
function writeIfChanged(filePath: string, content: string): void {
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf-8');
    if (existing === content) return;
  }
  writeFileSync(filePath, content, 'utf-8');
}
