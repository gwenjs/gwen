/**
 * @file Typed helper utilities for working with OXC AST nodes.
 *
 * All helpers use discriminated-union type checks before any cast,
 * following the GWEN strict-cast rule:
 *   (node as ConcreteType).field  only after  node.type === 'ConcreteType'  guard.
 */

import type {
  Expression,
  Statement,
  CallExpression,
  ObjectExpression,
  ObjectProperty,
  ArrayExpression,
  VariableDeclarator,
  Function as OxcFunction,
  ArrowFunctionExpression,
  IdentifierName,
  FunctionBody,
  StringLiteral,
  NumericLiteral,
} from 'oxc-parser';

// ─── Public type aliases ─────────────────────────────────────────────────────

/**
 * OXC function expression type (the `Function` interface with
 * `type: "FunctionExpression"`).  Re-exported under a conventional alias so
 * callers can write `FunctionExpression` in their own type positions.
 */
export type FunctionExpression = OxcFunction;

// ─── Identifier ──────────────────────────────────────────────────────────────

/**
 * Check if an expression is a direct call to a function named `name`.
 * Matches `foo(...)` but not `obj.foo(...)`.
 *
 * @param node - The expression node to check.
 * @param name - The expected callee identifier name.
 * @returns `true` when the expression is `CallExpression` whose callee is an
 *   `Identifier` with `.name === name`.
 *
 * @example
 * ```ts
 * if (isCallTo(expr, 'defineSystem')) { ... }
 * ```
 */
export function isCallTo(node: Expression, name: string): boolean {
  if (node.type !== 'CallExpression') return false;
  const call = node as CallExpression;
  if (call.callee.type !== 'Identifier') return false;
  return (call.callee as IdentifierName).name === name;
}

/**
 * Get the name string from an `IdentifierName` / `BindingIdentifier` /
 * `IdentifierReference` node (all share `type: "Identifier"`).
 * Returns `null` if the node is not an identifier.
 *
 * @param node - The expression to extract an identifier name from.
 * @returns The identifier string, or `null`.
 *
 * @example
 * ```ts
 * const name = getIdentifierName(arg); // 'Position' | null
 * ```
 */
export function getIdentifierName(node: Expression): string | null {
  if (node.type !== 'Identifier') return null;
  return (node as IdentifierName).name;
}

// ─── Literal values ───────────────────────────────────────────────────────────

/**
 * Get the string value from a string-literal node.
 * Both `StringLiteral` and `NumericLiteral` use `type: "Literal"` — this
 * helper distinguishes them by `typeof .value === 'string'`.
 * Returns `null` if the node is not a string literal.
 *
 * @param node - The expression to extract a string value from.
 * @returns The string value, or `null`.
 */
export function getStringValue(node: Expression): string | null {
  if (node.type !== 'Literal') return null;
  const value = (node as StringLiteral).value;
  return typeof value === 'string' ? value : null;
}

/**
 * Get the numeric value from a numeric-literal node.
 * Both `StringLiteral` and `NumericLiteral` use `type: "Literal"` — this
 * helper distinguishes them by `typeof .value === 'number'`.
 * Returns `null` if the node is not a numeric literal.
 *
 * @param node - The expression to extract a numeric value from.
 * @returns The number value, or `null`.
 */
export function getNumericValue(node: Expression): number | null {
  if (node.type !== 'Literal') return null;
  const value = (node as NumericLiteral).value;
  return typeof value === 'number' ? value : null;
}

// ─── Call expression ─────────────────────────────────────────────────────────

/**
 * Get the non-spread arguments from a `CallExpression`.
 * Filters out `SpreadElement` entries so every element in the returned array
 * is a plain `Expression`.
 *
 * @param node - The call expression node.
 * @returns Array of non-spread argument expressions (may be empty).
 *
 * @example
 * ```ts
 * const [first] = getCallArgs(callNode);
 * ```
 */
export function getCallArgs(node: CallExpression): Expression[] {
  return node.arguments.filter((a): a is Expression => a.type !== 'SpreadElement');
}

// ─── Function body ────────────────────────────────────────────────────────────

/**
 * Get the statement array from a function's block body.
 * Works for both regular function expressions (`Function` with
 * `type: "FunctionExpression"`) and arrow functions.
 * Returns an empty array when the function has no block body (e.g. concise
 * arrow expressions like `() => value`).
 *
 * @param fn - The function expression or arrow function expression.
 * @returns Array of statements in the body (may be empty).
 */
export function getFunctionBodyStatements(fn: OxcFunction | ArrowFunctionExpression): Statement[] {
  const { body } = fn;
  if (!body || body.type !== 'BlockStatement') return [];
  // FunctionBody.body is Array<Directive | Statement>.  Directive is
  // structurally an ExpressionStatement (same `type` discriminant) and is
  // safely treated as one here.
  return (body as FunctionBody).body as unknown as Statement[];
}

// ─── Variable declarator ─────────────────────────────────────────────────────

/**
 * Get the initializer expression from a `VariableDeclarator`.
 * Returns `null` when the declarator has no initializer (`let x;`).
 *
 * @param decl - The variable declarator node.
 * @returns The initializer expression, or `null`.
 */
export function getDeclaratorInit(decl: VariableDeclarator): Expression | null {
  return decl.init ?? null;
}

// ─── Array / object helpers ───────────────────────────────────────────────────

/**
 * Get the non-null, non-spread elements from an `ArrayExpression`.
 * Returns an empty array if the node is not an `ArrayExpression`.
 *
 * @param node - The expression to extract array elements from.
 * @returns Array of element expressions (holes and spreads are skipped).
 *
 * @example
 * ```ts
 * const components = getArrayElements(arg); // [Position, Velocity]
 * ```
 */
export function getArrayElements(node: Expression): Expression[] {
  if (node.type !== 'ArrayExpression') return [];
  const arr = node as ArrayExpression;
  return arr.elements.filter((el): el is Expression => el !== null && el.type !== 'SpreadElement');
}

/**
 * Get the non-spread properties from an `ObjectExpression`.
 * Returns an empty array if the node is not an `ObjectExpression`.
 * `SpreadElement` entries inside `properties` are filtered out so every
 * element in the returned array is a typed `ObjectProperty`.
 *
 * @param node - The expression (or `ObjectExpression`) to extract properties from.
 * @returns Array of object properties (may be empty).
 *
 * @example
 * ```ts
 * for (const prop of getObjectProperties(objNode)) { ... }
 * ```
 */
export function getObjectProperties(node: Expression | ObjectExpression): ObjectProperty[] {
  if (node.type !== 'ObjectExpression') return [];
  const obj = node as ObjectExpression;
  return obj.properties.filter((p): p is ObjectProperty => p.type !== 'SpreadElement');
}

/**
 * Get the string key name from an `ObjectProperty`.
 * Handles both `Identifier` keys (`{ foo: ... }`) and string `Literal` keys
 * (`{ 'foo': ... }`).
 * Returns `null` for computed keys or non-string literal keys.
 *
 * @param prop - The object property node.
 * @returns The key name as a string, or `null`.
 *
 * @example
 * ```ts
 * const key = getPropertyKeyName(prop); // 'query' | null
 * ```
 */
export function getPropertyKeyName(prop: ObjectProperty): string | null {
  const { key } = prop;
  if (key.type === 'Identifier') return (key as IdentifierName).name;
  if (key.type === 'Literal') {
    const value = (key as StringLiteral).value;
    return typeof value === 'string' ? value : null;
  }
  return null;
}
