import { createRequire } from "node:module";

/**
 * Package lib builds replace every value use of `__GWEN_DEV__` with this guard.
 * They must not bake in `true` or `false` — that would freeze published `dist`.
 * The guard is the only runtime `NODE_ENV` read, and it is emitted here, not written in `src`.
 */
export const GWEN_DEV_GUARD =
  '(typeof __GWEN_DEV__ !== "undefined" ? __GWEN_DEV__ : (globalThis.process?.env?.NODE_ENV !== "production"))';

interface OxcNode {
  type: string;
  start: number;
  end: number;
  name?: string;
  operator?: string;
  [key: string]: unknown;
}

interface ParseSync {
  (filename: string, source: string): { program: OxcNode };
}

function unwrap(node: OxcNode): OxcNode {
  let current = node;
  while (current.type === "ParenthesizedExpression" || current.type === "ChainExpression") {
    current = current.expression as OxcNode;
  }
  return current;
}

function isGuardConditional(node: OxcNode): boolean {
  const expr = unwrap(node);
  if (expr.type !== "ConditionalExpression") return false;
  const test = unwrap(expr.test as OxcNode);
  if (test.type !== "BinaryExpression" || test.operator !== "!==") return false;
  const left = unwrap(test.left as OxcNode);
  const right = unwrap(test.right as OxcNode);
  if (left.type !== "UnaryExpression" || left.operator !== "typeof") return false;
  const arg = unwrap(left.argument as OxcNode);
  if (arg.type !== "Identifier" || arg.name !== "__GWEN_DEV__") return false;
  if (right.type !== "Literal" || right.value !== "undefined") return false;
  const consequent = unwrap(expr.consequent as OxcNode);
  return consequent.type === "Identifier" && consequent.name === "__GWEN_DEV__";
}

function walk(node: OxcNode, visit: (node: OxcNode, parent: OxcNode | null) => void, parent: OxcNode | null = null): void {
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) walk(item, visit, node);
      }
    } else if (isNode(value)) {
      walk(value, visit, node);
    }
  }
}

function isNode(value: unknown): value is OxcNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as OxcNode).type === "string" &&
    typeof (value as OxcNode).start === "number"
  );
}

function loadParser(vitePackageJson: string): ParseSync {
  const required = createRequire(vitePackageJson)("oxc-parser") as { parseSync: ParseSync };
  return required.parseSync;
}

/**
 * Vite plugin for `@gwenjs/*` library builds.
 * `vitePackageJson` is the absolute path of `packages/vite/package.json` so
 * `oxc-parser` resolves from that package, not from the package being built.
 */
export function gwenLibDevGuard(vitePackageJson: string): {
  name: string;
  apply: "build";
  enforce: "pre";
  transform(code: string, id: string): { code: string; map: null } | null;
} {
  let parseSync: ParseSync | null = null;

  return {
    name: "gwen:lib-dev-guard",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("node_modules") || id.endsWith(".d.ts")) return null;
      if (!/\.[cm]?[jt]sx?$/.test(id)) return null;
      if (!code.includes("__GWEN_DEV__")) return null;
      parseSync ??= loadParser(vitePackageJson);
      let parsed: { program: OxcNode };
      try {
        parsed = parseSync(id, code);
      } catch {
        return null;
      }
      const edits: Array<{ start: number; end: number }> = [];
      walk(parsed.program, (node, parent) => {
        if (node.type !== "Identifier" || node.name !== "__GWEN_DEV__") return;
        if (parent?.type === "VariableDeclarator" && parent.id === node) return;
        if (parent?.type === "MemberExpression" && parent.property === node && parent.computed !== true) {
          return;
        }
        if (
          (parent?.type === "Property" || parent?.type === "PropertyDefinition") &&
          parent.key === node &&
          parent.computed !== true
        ) {
          return;
        }
        if (parent && isGuardConditional(parent)) return;
        if (parent?.type === "UnaryExpression" && parent.operator === "typeof") return;
        edits.push({ start: node.start, end: node.end });
      });
      if (edits.length === 0) return null;
      const ordered = edits.sort((a, b) => b.start - a.start);
      let next = code;
      for (const edit of ordered) {
        next = next.slice(0, edit.start) + GWEN_DEV_GUARD + next.slice(edit.end);
      }
      return { code: next, map: null };
    },
  };
}
