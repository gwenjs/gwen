/**
 * `gwen:actor-name` inserts `"Name", ` into a `defineActor` declarator.
 * Any declaration kind and any declarator of a multi-declarator declaration is named.
 * A string or template first argument stays the name. Zero arguments receive
 * the name inside the parentheses. `export default`, destructuring, and
 * `definePrefab` are left unchanged.
 * `useActor` calls in the factory become one dependency assignment after the
 * declaration, unless the call already passes `deps` or the module already
 * assigns that list.
 */

import type {
  Argument,
  ArrowFunctionExpression,
  AssignmentTarget,
  BindingPattern,
  CallExpression,
  Class,
  Function,
  ObjectExpression,
  Program,
  VariableDeclaration,
} from "oxc-parser";
import { walk, type WalkerThisContextEnter } from "../oxc/index.js";
import { ViteErrorCodes } from "../error-codes.js";
import type { NamedDeclarator } from "./named-declarator.js";
import { namedDeclarators } from "./named-declarator.js";
import type { GwenSourceTransform, TransformContext, TransformEdit } from "../pipeline/types.js";

const MODULE_SCOPE_HINT =
  "Declare the actor at module scope or pass it through the factory arguments.";

type NameKind = "absent" | "string" | "template" | "value";

function nameKind(call: CallExpression): NameKind {
  const first = call.arguments[0];
  if (first === undefined) return "absent";
  if (first.type === "TemplateLiteral") return "template";
  if (first.type === "Literal" && typeof first.value === "string") return "string";
  return "value";
}

function lastFunctionArgument(call: CallExpression): ArrowFunctionExpression | Function | null {
  for (let index = call.arguments.length - 1; index >= 0; index -= 1) {
    const argument = call.arguments[index];
    if (argument === undefined) continue;
    if (argument.type === "ArrowFunctionExpression" || argument.type === "FunctionExpression") {
      return argument;
    }
  }
  return null;
}

function hasDepsKey(object: ObjectExpression): boolean {
  for (const property of object.properties) {
    if (property.type !== "Property" || property.computed) continue;
    if (property.key.type === "Identifier" && property.key.name === "deps") return true;
    if (
      property.key.type === "Literal" &&
      typeof property.key.value === "string" &&
      property.key.value === "deps"
    ) {
      return true;
    }
  }
  return false;
}

/** `deps` is an object after the factory, not the factory itself. */
function explicitDepsAfter(
  call: CallExpression,
  factory: ArrowFunctionExpression | Function,
): boolean {
  let after = false;
  for (const argument of call.arguments) {
    if (argument === factory) {
      after = true;
      continue;
    }
    if (!after || argument.type !== "ObjectExpression") continue;
    if (hasDepsKey(argument)) return true;
  }
  return false;
}

function isPluginDepsTarget(target: AssignmentTarget, actorName: string): boolean {
  if (target.type !== "MemberExpression" || target.computed) return false;
  if (target.property.type !== "Identifier" || target.property.name !== "_deps") return false;
  const object = target.object;
  if (object.type !== "MemberExpression" || object.computed) return false;
  if (object.property.type !== "Identifier" || object.property.name !== "_plugin") return false;
  return object.object.type === "Identifier" && object.object.name === actorName;
}

function hasExistingDeps(program: Program, actorName: string): boolean {
  let found = false;
  walk(program, {
    enter(node) {
      if (found || node.type !== "ExpressionStatement") return;
      const expression = node.expression;
      if (expression.type !== "AssignmentExpression" || expression.operator !== "=") return;
      if (isPluginDepsTarget(expression.left, actorName)) found = true;
    },
  });
  return found;
}

/** Whitespace before the declaration on its line. Anything else means no indent. */
function lineIndent(code: string, at: number): string {
  const lineStart = code.lastIndexOf("\n", at - 1) + 1;
  const prefix = code.slice(lineStart, at);
  for (let index = 0; index < prefix.length; index += 1) {
    const char = prefix.charCodeAt(index);
    if (char !== 32 && char !== 9) return "";
  }
  return prefix;
}

/** Variable declarations that are statements of `program.body`, once per module. */
function topLevelVariableDeclarations(program: Program): ReadonlySet<VariableDeclaration> {
  const declarations = new Set<VariableDeclaration>();
  for (const statement of program.body) {
    if (statement.type === "VariableDeclaration") {
      declarations.add(statement);
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration" || statement.declaration === null) continue;
    if (statement.declaration.type !== "VariableDeclaration") continue;
    declarations.add(statement.declaration);
  }
  return declarations;
}

function patternNames(pattern: BindingPattern, names: string[]): void {
  if (pattern.type === "Identifier") {
    names.push(pattern.name);
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    patternNames(pattern.left, names);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      if (property.type === "RestElement") {
        patternNames(property.argument, names);
        continue;
      }
      patternNames(property.value, names);
    }
    return;
  }
  for (const element of pattern.elements) {
    if (element === null) continue;
    if (element.type === "RestElement") {
      patternNames(element.argument, names);
      continue;
    }
    patternNames(element, names);
  }
}

function recordVariable(declaration: VariableDeclaration, starts: Map<string, number>): void {
  const names: string[] = [];
  for (const declarator of declaration.declarations) patternNames(declarator.id, names);
  for (const name of names) {
    if (!starts.has(name)) starts.set(name, declaration.start);
  }
}

function recordClass(declaration: Class, starts: Map<string, number>): void {
  if (declaration.id === null) return;
  if (!starts.has(declaration.id.name)) starts.set(declaration.id.name, declaration.start);
}

/** Top-level `const` / `let` / `var` / `class` starts. Imports and functions are exempt. */
function laterBindings(program: Program): ReadonlyMap<string, number> {
  const starts = new Map<string, number>();
  for (const statement of program.body) {
    if (statement.type === "VariableDeclaration") {
      recordVariable(statement, starts);
      continue;
    }
    if (statement.type === "ClassDeclaration") {
      recordClass(statement, starts);
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration" || statement.declaration === null) continue;
    const declaration = statement.declaration;
    if (declaration.type === "VariableDeclaration") recordVariable(declaration, starts);
    if (declaration.type === "ClassDeclaration") recordClass(declaration, starts);
  }
  return starts;
}

function collectActorDeps(
  factory: ArrowFunctionExpression | Function,
  actorName: string,
  declarationEnd: number,
  later: ReadonlyMap<string, number>,
  checkDeclaredAfter: boolean,
  ctx: TransformContext,
): readonly string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  walk(factory, {
    enter(this: WalkerThisContextEnter, node) {
      if (node.type !== "CallExpression") return;
      const callee = ctx.resolveCallee(node);
      if (callee === "defineActor") {
        this.skip();
        return;
      }
      if (callee !== "useActor") return;
      const arg: Argument | undefined = node.arguments[0];
      if (arg === undefined || arg.type !== "Identifier") return;
      const dep = arg.name;
      if (!ctx.isModuleScopeBinding(dep, arg.start)) {
        ctx.raise(
          ViteErrorCodes.TRANSFORM_UNSUPPORTED,
          node,
          `useActor(${dep}) inside ${actorName}: ${dep} is not a module-scope binding.`,
          MODULE_SCOPE_HINT,
        );
      }
      const declaredAt = later.get(dep);
      if (checkDeclaredAfter && declaredAt !== undefined && declaredAt > declarationEnd) {
        ctx.raise(
          ViteErrorCodes.TRANSFORM_UNSUPPORTED,
          node,
          `useActor(${dep}) inside ${actorName}: ${dep} is declared after ${actorName}.`,
          MODULE_SCOPE_HINT,
        );
      }
      if (seen.has(dep)) return;
      seen.add(dep);
      ordered.push(dep);
    },
  });
  return ordered;
}

function dependencyNames(
  program: Program,
  hit: NamedDeclarator,
  ctx: TransformContext,
  later: ReadonlyMap<string, number>,
  topLevel: ReadonlySet<VariableDeclaration>,
): readonly string[] {
  if (hasExistingDeps(program, hit.name)) return [];
  const factory = lastFunctionArgument(hit.call);
  if (factory !== null && explicitDepsAfter(hit.call, factory)) return [];
  if (factory === null) return [];
  return collectActorDeps(
    factory,
    hit.name,
    hit.declaration.end,
    later,
    topLevel.has(hit.declaration),
    ctx,
  );
}

export const actorName: GwenSourceTransform = {
  name: "gwen:actor-name",
  run(program, ctx) {
    const edits: TransformEdit[] = [];
    const later = laterBindings(program);
    const topLevel = topLevelVariableDeclarations(program);
    for (const hit of namedDeclarators(program, ctx, "defineActor")) {
      const deps = dependencyNames(program, hit, ctx, later, topLevel);
      const kind = nameKind(hit.call);
      if (kind !== "string" && kind !== "template") {
        if (kind === "absent") {
          edits.push({ kind: "insert", at: hit.call.end - 1, text: `"${hit.name}"` });
        } else {
          const first = hit.call.arguments[0];
          if (first !== undefined) {
            edits.push({ kind: "insert", at: first.start, text: `"${hit.name}", ` });
          }
        }
      }
      if (deps.length > 0) {
        const list = deps.map((dep) => `${dep}._plugin`).join(", ");
        const indent = lineIndent(ctx.code, hit.declaration.start);
        edits.push({
          kind: "insert",
          at: hit.declaration.end,
          text: `\n${indent}${hit.name}._plugin._deps = [${list}];`,
        });
      }
    }
    return edits;
  },
};
