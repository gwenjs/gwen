/**
 * Dev-flag define, guard folding, and the `[gwen:dev-strip]` report.
 * Counts and rewrites use the oxc AST. No regex.
 */
import { Buffer } from "node:buffer";
import type { Plugin } from "vite";
import { parseSync } from "oxc-parser";
import { devFromResolvedConfig } from "./dev-from-config.js";

interface OxcNode {
  type: string;
  start: number;
  end: number;
  name?: string;
  operator?: string;
  value?: unknown;
  computed?: boolean;
  optional?: boolean;
  [key: string]: unknown;
}

export interface GwenDevStripReport {
  sites: number;
  sourceBytes: number;
  perFrameSites: number;
}

function isNode(value: unknown): value is OxcNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as OxcNode).type === "string" &&
    typeof (value as OxcNode).start === "number"
  );
}

function unwrap(node: OxcNode): OxcNode {
  let current = node;
  while (current.type === "ParenthesizedExpression" || current.type === "ChainExpression") {
    const inner = current.expression;
    if (!isNode(inner)) break;
    current = inner;
  }
  return current;
}

function isDevIdentifier(node: OxcNode): boolean {
  const expr = unwrap(node);
  return expr.type === "Identifier" && expr.name === "__GWEN_DEV__";
}

/**
 * `typeof __GWEN_DEV__ !== "undefined"`, or the minified form `typeof __GWEN_DEV__ < "u"`.
 * Both are true for every typeof result except `"undefined"`.
 */
function isTypeofDefinedTest(test: OxcNode): boolean {
  const expr = unwrap(test);
  if (expr.type !== "BinaryExpression") return false;
  const left = unwrap(expr.left as OxcNode);
  if (left.type !== "UnaryExpression" || left.operator !== "typeof") return false;
  const arg = unwrap(left.argument as OxcNode);
  if (!isDevIdentifier(arg) && arg.type !== "Literal") return false;
  const right = unwrap(expr.right as OxcNode);
  if (right.type !== "Literal") return false;
  if (expr.operator === "!==" && right.value === "undefined") return true;
  return expr.operator === "<" && right.value === "u";
}

/** The lib-build guard, before or after Vite replaces the identifier with a literal. */
function isGuard(node: OxcNode): boolean {
  const expr = unwrap(node);
  if (expr.type !== "ConditionalExpression") return false;
  if (!isNode(expr.test) || !isTypeofDefinedTest(expr.test)) return false;
  const consequent = unwrap(expr.consequent as OxcNode);
  if (isDevIdentifier(consequent)) return true;
  return consequent.type === "Literal" && (consequent.value === true || consequent.value === false);
}

function isDevFlag(node: OxcNode): boolean {
  return isDevIdentifier(node) || isGuard(node);
}

function isDebugMember(node: OxcNode): boolean {
  const expr = unwrap(node);
  return (
    expr.type === "MemberExpression" &&
    expr.computed !== true &&
    isNode(expr.property) &&
    expr.property.type === "Identifier" &&
    expr.property.name === "debug"
  );
}

function childNodes(node: OxcNode): OxcNode[] {
  const out: OxcNode[] = [];
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
}

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

function isInstrumentInit(node: OxcNode): boolean {
  const expr = unwrap(node);
  if (expr.type !== "LogicalExpression" || expr.operator !== "&&") return false;
  return isDevFlag(expr.left as OxcNode) && isDebugMember(expr.right as OxcNode);
}

type Kind = "dev" | "dev-debug";

function classify(test: OxcNode, isInstrument: (name: string) => boolean): Kind | null {
  const expr = unwrap(test);
  if (expr.type === "Identifier" && expr.name && isInstrument(expr.name)) return "dev-debug";
  if (isDevFlag(expr)) return "dev";
  if (expr.type === "LogicalExpression" && expr.operator === "&&") {
    const left = unwrap(expr.left as OxcNode);
    const right = unwrap(expr.right as OxcNode);
    const leftIsFlag =
      isDevFlag(left) || (left.type === "Identifier" && !!left.name && isInstrument(left.name));
    if (!leftIsFlag) return null;
    if (
      isDebugMember(right) ||
      (left.type === "Identifier" && left.name && isInstrument(left.name))
    ) {
      return "dev-debug";
    }
    return "dev";
  }
  return null;
}

export function analyzeDevSites(code: string, filename: string): GwenDevStripReport {
  const count: GwenDevStripReport = { sites: 0, sourceBytes: 0, perFrameSites: 0 };
  let program: OxcNode;
  try {
    program = parseSync(filename, code).program as unknown as OxcNode;
  } catch {
    return count;
  }
  const scopes: Array<Set<string>> = [new Set()];

  const isInstrument = (name: string): boolean => {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
      const scope = scopes[i];
      if (scope?.has(name)) return true;
    }
    return false;
  };

  const visit = (node: OxcNode): void => {
    const entersFunction = FUNCTION_TYPES.has(node.type);
    if (entersFunction) scopes.push(new Set());
    if (
      node.type === "VariableDeclarator" &&
      isNode(node.id) &&
      node.id.type === "Identifier" &&
      node.id.name
    ) {
      const init = node.init;
      if (isNode(init) && isInstrumentInit(init)) scopes[scopes.length - 1]?.add(node.id.name);
    }
    if (node.type === "IfStatement" && isNode(node.test)) {
      const kind = classify(node.test, isInstrument);
      if (kind) add(node, kind);
    } else if (node.type === "ConditionalExpression" && isNode(node.test) && !isGuard(node)) {
      const kind = classify(node.test, isInstrument);
      if (kind) add(node, kind);
    } else if (
      node.type === "ExpressionStatement" &&
      isNode(node.expression) &&
      node.expression.type === "LogicalExpression"
    ) {
      // Package minify turns `if (instrument) expr` into `instrument && expr`.
      const kind = classify(node.expression, isInstrument);
      if (kind) add(node.expression, kind);
    } else if (node.type === "SequenceExpression" && Array.isArray(node.expressions)) {
      for (const element of node.expressions) {
        if (!isNode(element) || element.type !== "LogicalExpression") continue;
        const kind = classify(element, isInstrument);
        if (kind) add(element, kind);
      }
    }
    for (const child of childNodes(node)) visit(child);
    if (entersFunction) scopes.pop();
  };

  const add = (node: OxcNode, kind: Kind): void => {
    count.sites += 1;
    count.sourceBytes += Buffer.byteLength(code.slice(node.start, node.end));
    if (kind === "dev-debug") count.perFrameSites += 1;
  };

  visit(program);
  return count;
}

function guardSpans(code: string, filename: string): Array<{ start: number; end: number }> {
  let program: OxcNode;
  try {
    program = parseSync(filename, code).program as unknown as OxcNode;
  } catch {
    return [];
  }
  const spans: Array<{ start: number; end: number }> = [];
  const visit = (node: OxcNode, parent: OxcNode | null): void => {
    if (node.type === "ConditionalExpression" && isGuard(node)) {
      const coveredByParen =
        parent?.type === "ParenthesizedExpression" && parent.expression === node;
      if (!coveredByParen) spans.push({ start: node.start, end: node.end });
    }
    if (
      node.type === "ParenthesizedExpression" &&
      isNode(node.expression) &&
      isGuard(node.expression)
    ) {
      spans.push({ start: node.start, end: node.end });
    }
    for (const child of childNodes(node)) visit(child, node);
  };
  visit(program, null);
  return spans;
}

/** Value positions of `__GWEN_DEV__` that are not already covered by a guard span. */
function valueFlagSpans(
  code: string,
  filename: string,
  guardRanges: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  let program: OxcNode;
  try {
    program = parseSync(filename, code).program as unknown as OxcNode;
  } catch {
    return [];
  }
  const spans: Array<{ start: number; end: number }> = [];
  const visit = (node: OxcNode, parent: OxcNode | null): void => {
    if (node.type === "Identifier" && node.name === "__GWEN_DEV__") {
      const insideGuard = guardRanges.some(
        (range) => node.start >= range.start && node.end <= range.end,
      );
      const declaration = parent?.type === "VariableDeclarator" && parent.id === node;
      const memberProp =
        parent?.type === "MemberExpression" && parent.property === node && parent.computed !== true;
      const key =
        (parent?.type === "Property" || parent?.type === "PropertyDefinition") &&
        parent.key === node &&
        parent.computed !== true;
      if (!insideGuard && !declaration && !memberProp && !key)
        spans.push({ start: node.start, end: node.end });
    }
    for (const child of childNodes(node)) visit(child, node);
  };
  visit(program, null);
  return spans;
}

/** Comments are kept when minify is off. Drop the ones that would leave the flag in prod output. */
function devTokenCommentSpans(
  code: string,
  filename: string,
): Array<{ start: number; end: number }> {
  try {
    const parsed = parseSync(filename, code) as {
      comments?: Array<{ start: number; end: number }>;
    };
    const spans: Array<{ start: number; end: number }> = [];
    for (const comment of parsed.comments ?? []) {
      const text = code.slice(comment.start, comment.end);
      if (
        text.includes("__GWEN_DEV__") ||
        text.includes("import.meta.env") ||
        text.includes("GWEN_DEV_GUARD")
      ) {
        spans.push({ start: comment.start, end: comment.end });
      }
    }
    return spans;
  } catch {
    return [];
  }
}

function cleanModuleId(id: string): string {
  const noQuery = id.split("?", 1)[0] ?? id;
  return noQuery.startsWith("/@fs/") ? noQuery.slice("/@fs".length) : noQuery;
}

/** Installed `@gwenjs/*` packages. Other `node_modules` stay out of the strip. */
function isInstalledGwenModule(id: string): boolean {
  return /(?:^|[/\\])node_modules[/\\]@gwenjs[/\\]/.test(id);
}

/**
 * Defines `__GWEN_DEV__` from Vite's `import.meta.env.DEV`, folds the lib-build
 * guard to that literal, and prints the strip report for production app builds.
 */
export function gwenDevStripPlugin(): Plugin {
  let dev = true;
  let report = false;
  const counts = new Map<string, GwenDevStripReport>();

  return {
    name: "gwen:dev-strip",
    enforce: "pre",
    configResolved(config) {
      dev = devFromResolvedConfig(config);
      const literal = JSON.stringify(dev);
      // Vite computes env.DEV after the config hook. The resolved `define` bag is writable at runtime.
      const host = config as unknown as {
        define?: Record<string, string>;
        environments?: Record<string, { define?: Record<string, string> }>;
      };
      const define = (host.define ??= {});
      define.__GWEN_DEV__ = literal;
      for (const environment of Object.values(host.environments ?? {})) {
        if (!environment.define) continue;
        environment.define.__GWEN_DEV__ = literal;
      }
      report = config.command === "build" && !dev;
      counts.clear();
    },
    transform(code, id) {
      if (id.startsWith("\0")) return null;
      if (id.includes("node_modules") && !isInstalledGwenModule(id)) return null;
      if (!/\.[cm]?[jt]sx?$/.test(id.split("?", 1)[0] ?? id)) return null;
      if (!code.includes("__GWEN_DEV__") && !code.includes("GWEN_DEV")) return null;
      const cleanId = cleanModuleId(id);
      counts.set(cleanId, analyzeDevSites(code, cleanId));
      const literal = dev ? "true" : "false";
      const guards = code.includes("typeof") ? guardSpans(code, cleanId) : [];
      const edits: Array<{ start: number; end: number; text: string }> = [
        ...guards.map((span) => ({ ...span, text: literal })),
        ...valueFlagSpans(code, cleanId, guards).map((span) => ({ ...span, text: literal })),
        ...(dev ? [] : devTokenCommentSpans(code, cleanId).map((span) => ({ ...span, text: "" }))),
      ];
      if (edits.length === 0) return null;
      let next = code;
      for (const edit of edits.sort((a, b) => b.start - a.start)) {
        next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
      }
      return { code: next, map: null };
    },
    generateBundle(_options, bundle) {
      if (!report) return;
      let sites = 0;
      let sourceBytes = 0;
      let perFrameSites = 0;
      const seen = new Set<string>();
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        for (const id of Object.keys(item.modules)) {
          const cleanId = cleanModuleId(id);
          if (seen.has(cleanId)) continue;
          seen.add(cleanId);
          const found = counts.get(cleanId);
          if (!found) continue;
          sites += found.sites;
          sourceBytes += found.sourceBytes;
          perFrameSites += found.perFrameSites;
        }
      }
      this.info(
        `[gwen:dev-strip] removed ${sites} dev-only sites (${sourceBytes} B source), ${perFrameSites} per-frame instrumentation sites`,
      );
    },
  };
}
