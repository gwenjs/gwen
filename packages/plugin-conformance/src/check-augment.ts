import ts from "typescript";
import { ConformanceErrorCodes } from "./error-codes.js";
import { FRAMEWORK_PROVIDES_KEYS } from "./framework-entries.generated.js";
import { isRecord } from "./json.js";
import type { PackageContext } from "./package-context.js";
import {
  lineOf,
  listRuntimeFiles,
  listTestFiles,
  parseSource,
  readSourceText,
} from "./source-files.js";
import type { SourceFile } from "./source-files.js";
import type { ConformanceFinding } from "./types.js";

const SCHEMA = "@gwenjs/schema";

function packageName(manifest: unknown): string {
  return isRecord(manifest) && typeof manifest.name === "string" ? manifest.name : "";
}

function memberName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) {
    return name.expression.text;
  }
  return undefined;
}

function isOwnModule(target: string, own: string): boolean {
  return own !== "" && (target === own || target.startsWith(`${own}/`));
}

function scanFile(file: SourceFile, text: string, own: string): ConformanceFinding[] {
  const source = parseSource(file, text);
  const findings: ConformanceFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      const target = node.name.text;
      if (target === SCHEMA && node.body !== undefined && ts.isModuleBlock(node.body)) {
        for (const statement of node.body.statements) {
          if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== "GwenProvides") {
            continue;
          }
          for (const member of statement.members) {
            if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) continue;
            const key = memberName(member.name);
            if (key === undefined || !Object.hasOwn(FRAMEWORK_PROVIDES_KEYS, key)) continue;
            findings.push({
              code: ConformanceErrorCodes.AUGMENT_TARGET,
              message: `GwenProvides key "${key}" is already declared by ${FRAMEWORK_PROVIDES_KEYS[key]}`,
              hint: `Pick a service key of your own, for example "<plugin>:<service>".`,
              file: file.relative,
              line: lineOf(source, member.name),
            });
          }
        }
      } else if (target.startsWith("@gwenjs/") && target !== SCHEMA && !isOwnModule(target, own)) {
        findings.push({
          code: ConformanceErrorCodes.AUGMENT_TARGET,
          message: `declare module "${target}" augments a framework package`,
          hint: "Augment @gwenjs/schema instead: add the service to GwenProvides or the hook to GwenRuntimeHooks.",
          file: file.relative,
          line: lineOf(source, node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** The files of `src` and the test files, once each: `src/__tests__/a.ts` is in both lists. */
async function listScanned(root: string): Promise<readonly SourceFile[]> {
  const files = new Map<string, SourceFile>();
  for (const file of [...(await listRuntimeFiles(root)), ...(await listTestFiles(root))]) {
    if (!files.has(file.relative)) files.set(file.relative, file);
  }
  return [...files.values()];
}

/**
 * Augmentation rules: a `declare module` of a framework package other than `@gwenjs/schema` (the
 * package's own name and its subpaths are not reported), and a `GwenProvides` key of
 * `@gwenjs/schema` that the framework already declares. Every script file of `src` and every test
 * file is read. A file that cannot be read (any error but a missing one) rejects.
 */
export async function checkAugment(
  context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  const own = packageName(context.manifest);
  const findings: ConformanceFinding[] = [];
  // One read at a time: a wide `src` must not exhaust file descriptors.
  for (const file of await listScanned(context.root)) {
    const text = await readSourceText(file);
    if (text !== undefined) findings.push(...scanFile(file, text, own));
  }
  return findings;
}
