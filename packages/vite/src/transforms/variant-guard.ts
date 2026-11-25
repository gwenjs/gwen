/**
 * `gwen:variant-guard` raises `VITE:VARIANT_REQUIRED` when a project module value-imports a
 * variant package (or a subpath of one) and the resolved variant differs from that package's
 * variant, or the package is not in the resolved modules. It never edits the source.
 *
 * Checked: `import`, `export ... from`, `export * from`, `import("literal")` (a string or a
 * template without substitution) and `import x = require("literal")`.
 * Allowed: type-only forms, packages outside the table, and modules outside the project root.
 * Not checked: `require()` calls and `import(expr)` with a computed source.
 */

import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Expression, StringLiteral, TSModuleReference } from "oxc-parser";
import type { GwenEngineConfig } from "@gwenjs/schema";
import { ViteErrorCodes } from "../error-codes.js";
import { walk, type Node } from "../oxc/index.js";
import { pathWithoutQuery } from "../pipeline/parse.js";
import type { GwenSourceTransform, TransformEdit } from "../pipeline/types.js";

type Variant = GwenEngineConfig["variant"];

export interface VariantGuardOptions {
  /** Project root. Only modules under it are checked. */
  readonly root: string;
  /** Resolved engine variant of the build. */
  readonly variant: Variant;
  /** Resolved module names (`gwenConfig.modules`). */
  readonly declaredModules: readonly string[];
}

/**
 * Variant of each package that needs one. A drift test pins it to `detectCoreVariant`
 * (`packages/vite/tests/transform-pipeline/variant-guard.test.ts`).
 */
export const VARIANT_PACKAGES: Readonly<Record<string, Variant>> = {
  "@gwenjs/physics2d": "physics2d",
  "@gwenjs/physics3d": "physics3d",
};

interface PackageHit {
  readonly pkg: string;
  readonly variant: Variant;
}

/** One module reference: the node to point at and the specifier text. */
interface Reference {
  readonly node: { readonly start: number; readonly end: number };
  readonly spec: string;
}

const NO_EDITS: readonly TransformEdit[] = [];

function matchPackage(spec: string): PackageHit | null {
  for (const [pkg, variant] of Object.entries(VARIANT_PACKAGES)) {
    if (spec === pkg || spec.startsWith(`${pkg}/`)) return { pkg, variant };
  }
  return null;
}

/** The variant a specifier needs, or `null` when it is not a table package or a subpath of one. */
export function variantOfPackage(spec: string): Variant | null {
  return matchPackage(spec)?.variant ?? null;
}

/** An empty list (`import "p"`, `export {} from "p"`) is a value import: it runs the module. */
function anyValue(kinds: readonly string[]): boolean {
  if (kinds.length === 0) return true;
  return kinds.some((kind) => kind !== "type");
}

function fromLiteral(literal: StringLiteral): Reference {
  return { node: literal, spec: literal.value };
}

function fromDynamicSource(source: Expression): Reference | null {
  if (source.type === "Literal") {
    return typeof source.value === "string" ? { node: source, spec: source.value } : null;
  }
  if (source.type !== "TemplateLiteral") return null;
  const only = source.quasis[0];
  // A substitution always adds a quasi, so one quasi means no substitution.
  if (only === undefined || source.quasis.length !== 1) return null;
  const cooked = only.value.cooked;
  return typeof cooked === "string" ? { node: source, spec: cooked } : null;
}

function fromModuleReference(reference: TSModuleReference): Reference | null {
  if (reference.type !== "TSExternalModuleReference") return null;
  return fromLiteral(reference.expression);
}

/** The reference a node makes at run time, or `null` for a type-only form or no source. */
function valueReference(node: Node): Reference | null {
  switch (node.type) {
    case "ImportDeclaration": {
      const kinds = node.specifiers.map((specifier) =>
        specifier.type === "ImportSpecifier" ? (specifier.importKind ?? "value") : "value",
      );
      if (node.importKind === "type" || !anyValue(kinds)) return null;
      return fromLiteral(node.source);
    }
    case "ExportAllDeclaration":
      if (node.exportKind === "type") return null;
      return fromLiteral(node.source);
    case "ExportNamedDeclaration": {
      if (node.source === null || node.exportKind === "type") return null;
      const kinds = node.specifiers.map((specifier) => specifier.exportKind ?? "value");
      if (!anyValue(kinds)) return null;
      return fromLiteral(node.source);
    }
    case "ImportExpression":
      return fromDynamicSource(node.source);
    case "TSImportEqualsDeclaration":
      if (node.importKind === "type") return null;
      return fromModuleReference(node.moduleReference);
    default:
      return null;
  }
}

/** The root as the module ids spell it: absolute, symlinks resolved when the path exists. */
function normalizeRoot(root: string): string {
  const resolved = resolve(root);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Path of `id` under `root` with `/` separators, or `null` when `id` is outside it. */
function relativeToRoot(root: string, id: string): string | null {
  const path = relative(root, pathWithoutQuery(id));
  if (isAbsolute(path)) return null;
  const posix = path.split(sep).join("/");
  if (posix === ".." || posix.startsWith("../")) return null;
  return posix;
}

export function createVariantGuard(options: VariantGuardOptions): GwenSourceTransform {
  const root = normalizeRoot(options.root);
  return {
    name: "gwen:variant-guard",
    run(program, ctx) {
      const rel = relativeToRoot(root, ctx.id);
      if (rel === null) return NO_EDITS;
      walk(program, {
        enter(node) {
          const reference = valueReference(node);
          if (reference === null) return;
          const hit = matchPackage(reference.spec);
          if (hit === null) return;
          const { spec } = reference;
          if (hit.variant !== options.variant) {
            ctx.raise(
              ViteErrorCodes.VARIANT_REQUIRED,
              reference.node,
              `${rel} imports ${spec}, which needs the "${hit.variant}" variant; the build is "${options.variant}".`,
              `Add "${hit.pkg}" to modules in gwen.config.ts (the variant follows), or remove the import.`,
            );
          }
          if (!options.declaredModules.includes(hit.pkg)) {
            ctx.raise(
              ViteErrorCodes.VARIANT_REQUIRED,
              reference.node,
              `${rel} imports ${spec}, but "${hit.pkg}" is not in modules (the build is "${options.variant}").`,
              `Add "${hit.pkg}" to modules in gwen.config.ts, or remove the import.`,
            );
          }
        },
      });
      return NO_EDITS;
    },
  };
}
