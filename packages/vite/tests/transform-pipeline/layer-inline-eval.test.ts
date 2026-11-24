/**
 * `evalConstInt` on one oxc expression.
 * `0,` keeps the expression out of statement position.
 * The helper is absent on the base, so each `toBe` sees `undefined`.
 */

import {
  parseSync,
  type Expression,
  type ExpressionStatement,
  type SequenceExpression,
} from "oxc-parser";
import { describe, expect, it } from "vitest";
import * as layerUtils from "../../src/shared/layer-utils.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExpressionStatement(value: unknown): value is ExpressionStatement {
  return isRecord(value) && value["type"] === "ExpressionStatement";
}

function isSequenceExpression(value: unknown): value is SequenceExpression {
  return isRecord(value) && value["type"] === "SequenceExpression";
}

function isEvalConstInt(value: unknown): value is (node: Expression) => number | null {
  return typeof value === "function";
}

function expressionOf(source: string): Expression {
  const parsed = parseSync("expr.ts", `0, ${source};\n`);
  const statement = parsed.program.body[0];
  if (!isExpressionStatement(statement)) throw new Error("expected an expression statement");
  const expression = statement.expression;
  if (!isSequenceExpression(expression)) throw new Error("expected a sequence expression");
  const node = expression.expressions[1];
  if (node === undefined) throw new Error("expected a second expression");
  return node;
}

function evalConstInt(source: string): number | null | undefined {
  const found: unknown = Reflect.get(layerUtils, "evalConstInt");
  if (!isEvalConstInt(found)) return undefined;
  return found(expressionOf(source));
}

describe("evalConstInt", () => {
  it("1 << 31 is 2147483648 (unsigned)", () => {
    expect(evalConstInt("1 << 31")).toBe(2147483648);
  });

  it("1 << 32 is 1 (JS shift count)", () => {
    expect(evalConstInt("1 << 32")).toBe(1);
  });

  it("~1 is 4294967294", () => {
    expect(evalConstInt("~1")).toBe(4294967294);
  });

  it("hex, binary and decimal literals mix with | & ^ and parentheses", () => {
    expect(evalConstInt("(0xff | 0b101) & (10 ^ 1)")).toBe(11);
  });

  it(">> and >>> shift right in the unsigned domain", () => {
    expect(evalConstInt("~0 >> 1")).toBe(2147483647);
    expect(evalConstInt("1 << 31 >> 31")).toBe(1);
    expect(evalConstInt("~0 >>> 4")).toBe(268435455);
  });

  it("an identifier, a call, a template or a division returns null", () => {
    expect(evalConstInt("SOME_CONST")).toBeNull();
    expect(evalConstInt("foo()")).toBeNull();
    expect(evalConstInt("`1`")).toBeNull();
    expect(evalConstInt("1 / 2")).toBeNull();
  });
});
