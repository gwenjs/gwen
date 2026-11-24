/**
 * `gwen:async-context` wraps each `await` inside an inline async handler
 * passed to `onEnter`, `onExit`, or `withAsyncContext`.
 * The callee is the import binding from `ctx.resolveCallee`.
 * A nested `await` in an await argument raises `VITE:TRANSFORM_UNSUPPORTED`.
 */

import type {
  ArrowFunctionExpression,
  AwaitExpression,
  CallExpression,
  Function,
  Node,
  Program,
} from "oxc-parser";
import { walk, type WalkerThisContextEnter } from "../oxc/index.js";
import { ViteErrorCodes } from "../error-codes.js";
import type { GwenSourceTransform, TransformContext, TransformEdit } from "../pipeline/types.js";

const STATEMENT_PREFIX = ";(([__temp,__restore]=__executeAsync(()=>";
const STATEMENT_SUFFIX = ")),await __temp,__restore())";
const EXPRESSION_PREFIX = "(([__temp,__restore]=__executeAsync(()=>";
const EXPRESSION_SUFFIX = ")),__temp=await __temp,__restore(),__temp)";
const BINDING = " let __temp, __restore;";
const RETURN_OPEN = "{ let __temp, __restore; return ";
const RETURN_CLOSE = " }";
const HELPER_IMPORT = 'import { executeAsync as __executeAsync } from "@gwenjs/core/internal";\n';

const NESTED_WHAT = "Nested await inside an await argument.";
const NESTED_HINT = "Assign the inner await to a const first.";

interface AwaitSite {
  readonly node: AwaitExpression;
  readonly statement: boolean;
}

function isAsyncCallee(call: CallExpression, ctx: TransformContext): boolean {
  const bound = ctx.resolveCallee(call);
  return bound === "onEnter" || bound === "onExit" || bound === "withAsyncContext";
}

function isAsyncHandler(node: Node): node is ArrowFunctionExpression | Function {
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
    return node.async === true;
  }
  return false;
}

function isFunctionOrClass(node: Node): boolean {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ClassDeclaration" ||
    node.type === "ClassExpression"
  );
}

function isStatementList(parent: Node | null): boolean {
  if (parent === null) return false;
  return (
    parent.type === "Program" || parent.type === "BlockStatement" || parent.type === "SwitchCase"
  );
}

function isOwnTemp(node: AwaitExpression): boolean {
  return node.argument.type === "Identifier" && node.argument.name === "__temp";
}

function collectAwaits(
  handler: ArrowFunctionExpression | Function,
  ctx: TransformContext,
): AwaitSite[] {
  const statementStarts = new Set<number>();
  const found: AwaitSite[] = [];
  let awaitDepth = 0;
  walk(handler, {
    enter(this: WalkerThisContextEnter, node, parent) {
      if (node !== handler && isFunctionOrClass(node)) {
        this.skip();
        return;
      }
      if (
        node.type === "ExpressionStatement" &&
        isStatementList(parent) &&
        node.expression.type === "AwaitExpression"
      ) {
        statementStarts.add(node.expression.start);
      }
      if (node.type !== "AwaitExpression") return;
      if (awaitDepth > 0) {
        ctx.raise(ViteErrorCodes.TRANSFORM_UNSUPPORTED, node, NESTED_WHAT, NESTED_HINT);
      }
      awaitDepth += 1;
      if (isOwnTemp(node)) return;
      found.push({ node, statement: statementStarts.has(node.start) });
    },
    leave(node) {
      if (node.type === "AwaitExpression") awaitDepth -= 1;
    },
  });
  return found;
}

function pushAwait(edits: TransformEdit[], site: AwaitSite): void {
  const prefix = site.statement ? STATEMENT_PREFIX : EXPRESSION_PREFIX;
  const suffix = site.statement ? STATEMENT_SUFFIX : EXPRESSION_SUFFIX;
  const objectLiteral = site.node.argument.type === "ObjectExpression";
  edits.push({
    kind: "overwrite",
    start: site.node.start,
    end: site.node.argument.start,
    text: objectLiteral ? `${prefix}(` : prefix,
  });
  edits.push({
    kind: "insert",
    at: site.node.argument.end,
    text: objectLiteral ? `)${suffix}` : suffix,
  });
}

function pushBinding(
  edits: TransformEdit[],
  body: { type: string; start: number; end: number } | null,
): void {
  if (body === null) return;
  if (body.type === "BlockStatement") {
    edits.push({ kind: "insert", at: body.start + 1, text: BINDING });
    return;
  }
  edits.push({ kind: "insert", at: body.start, text: RETURN_OPEN });
  edits.push({ kind: "insert", at: body.end, text: RETURN_CLOSE });
}

function instrument(
  handler: ArrowFunctionExpression | Function,
  edits: TransformEdit[],
  ctx: TransformContext,
): number {
  const found = collectAwaits(handler, ctx);
  for (const item of found) {
    pushAwait(edits, item);
  }
  if (found.length > 0) pushBinding(edits, handler.body);
  return found.length;
}

function isDirective(statement: Program["body"][number]): boolean {
  return statement.type === "ExpressionStatement" && typeof statement.directive === "string";
}

function helperAt(program: Program): number | undefined {
  for (const statement of program.body) {
    if (isDirective(statement)) continue;
    return statement.start;
  }
  return undefined;
}

function helperBound(program: Program): boolean {
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    if (statement.source.value !== "@gwenjs/core/internal") continue;
    for (const spec of statement.specifiers) {
      if (spec.local.name === "__executeAsync") return true;
    }
  }
  return false;
}

export const asyncContext: GwenSourceTransform = {
  name: "gwen:async-context",
  run(program, ctx) {
    const edits: TransformEdit[] = [];
    let rewritten = 0;
    walk(program, {
      enter(node) {
        if (node.type !== "CallExpression") return;
        if (!isAsyncCallee(node, ctx)) return;
        for (const argument of node.arguments) {
          if (!isAsyncHandler(argument)) continue;
          rewritten += instrument(argument, edits, ctx);
        }
      },
    });
    if (rewritten > 0 && helperBound(program) === false) {
      const at = helperAt(program);
      if (at !== undefined) {
        edits.push({ kind: "insert", at, text: HELPER_IMPORT });
      }
    }
    return edits;
  },
};
