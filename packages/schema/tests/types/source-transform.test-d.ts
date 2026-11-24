import { describe, expectTypeOf, it } from "vitest";
import type {
  GwenAstArgument,
  GwenAstNode,
  GwenSourceTransform,
  GwenTransformContext,
  GwenTransformEdit,
} from "@gwenjs/schema";

describe("source transform contract", () => {
  it("GwenTransformContext has exactly the 8 contract members", () => {
    expectTypeOf<keyof GwenTransformContext>().toEqualTypeOf<
      "id" | "code" | "calls" | "resolveImport" | "walk" | "raise" | "warn" | "emitAsset"
    >();
  });

  it("GwenCallSite arguments narrow on kind", () => {
    expectTypeOf<Extract<GwenAstArgument, { kind: "string" }>["value"]>().toEqualTypeOf<string>();
    expectTypeOf<Extract<GwenAstArgument, { kind: "number" }>["value"]>().toEqualTypeOf<number>();
    expectTypeOf<
      Extract<GwenAstArgument, { kind: "other" }>["node"]
    >().toEqualTypeOf<GwenAstNode>();
  });

  it("raise returns never", () => {
    expectTypeOf<GwenTransformContext["raise"]>().returns.toEqualTypeOf<never>();
  });

  it("warn returns void", () => {
    expectTypeOf<GwenTransformContext["warn"]>().returns.toEqualTypeOf<void>();
  });

  it("GwenSourceTransform.run accepts a sync or a Promise result", () => {
    expectTypeOf<ReturnType<GwenSourceTransform["run"]>>().toEqualTypeOf<
      readonly GwenTransformEdit[] | Promise<readonly GwenTransformEdit[]>
    >();
  });

  it("no transform type mentions oxc", () => {
    expectTypeOf<GwenAstNode["type"]>().toEqualTypeOf<string>();
    expectTypeOf<GwenAstNode["start"]>().toEqualTypeOf<number>();
    expectTypeOf<GwenAstNode["end"]>().toEqualTypeOf<number>();
    expectTypeOf<GwenAstNode["callee"]>().toEqualTypeOf<unknown>();
  });
});
