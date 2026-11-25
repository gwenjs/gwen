import { describe, expectTypeOf, it } from "vitest";
import {
  GWEN_INTROSPECTION_DEFAULT_MAX_PAGE,
  GWEN_INTROSPECTION_ERROR_CODES,
  GWEN_INTROSPECTION_SERVICE,
  GWEN_INTROSPECTION_VERSION,
  type EntityId,
  type GwenEngineServiceKey,
  type GwenIntrospection,
  type GwenIntrospectionEntity,
  type GwenIntrospectionEntityPage,
  type GwenIntrospectionLimits,
  type GwenIntrospectionPageRequest,
  type GwenPluginServiceKey,
  type GwenProvides,
} from "@gwenjs/schema";

type IfEquals<X, Y, A, B> =
  (<U>() => U extends X ? 1 : 2) extends <U>() => U extends Y ? 1 : 2 ? A : B;

/** Keys whose property is `readonly`. */
type ReadonlyKeys<T> = {
  [K in keyof T]-?: IfEquals<{ [P in K]: T[K] }, { -readonly [P in K]: T[K] }, never, K>;
}[keyof T];

describe("introspection contract", () => {
  it("GwenIntrospection has exactly seven members, all read-only", () => {
    expectTypeOf<keyof GwenIntrospection>().toEqualTypeOf<
      "version" | "limits" | "revisions" | "snapshot" | "entities" | "entity" | "hooks"
    >();
    expectTypeOf<ReadonlyKeys<GwenIntrospection>>().toEqualTypeOf<keyof GwenIntrospection>();
  });

  it('GwenProvides["introspection"] is GwenIntrospection', () => {
    expectTypeOf<GwenProvides["introspection"]>().toEqualTypeOf<GwenIntrospection>();
  });

  it("introspection is an engine key and a plugin may not provide it", () => {
    expectTypeOf<"introspection">().toExtend<GwenEngineServiceKey>();
    expectTypeOf<"introspection">().not.toExtend<GwenPluginServiceKey>();
  });

  it("the constants keep their literal types", () => {
    expectTypeOf(GWEN_INTROSPECTION_SERVICE).toEqualTypeOf<"introspection">();
    expectTypeOf(GWEN_INTROSPECTION_VERSION).toEqualTypeOf<1>();
    expectTypeOf(GWEN_INTROSPECTION_DEFAULT_MAX_PAGE).toEqualTypeOf<1000>();
    expectTypeOf(
      GWEN_INTROSPECTION_ERROR_CODES.PAGE_INVALID,
    ).toEqualTypeOf<"CORE:INTROSPECTION_PAGE_INVALID">();
  });

  it("GwenIntrospectionPageRequest is a read-only offset and limit", () => {
    expectTypeOf<GwenIntrospectionPageRequest>().toEqualTypeOf<{
      readonly offset: number;
      readonly limit: number;
    }>();
  });

  it("GwenIntrospectionLimits holds only maxPageSize", () => {
    expectTypeOf<GwenIntrospectionLimits>().toEqualTypeOf<{ readonly maxPageSize: number }>();
  });

  it("entities takes a page request and returns the page", () => {
    expectTypeOf<GwenIntrospection["entities"]>().parameters.toEqualTypeOf<
      [GwenIntrospectionPageRequest]
    >();
    expectTypeOf<
      GwenIntrospection["entities"]
    >().returns.toEqualTypeOf<GwenIntrospectionEntityPage>();
  });

  it("entity takes a bigint, an EntityId fits, and it may return undefined", () => {
    expectTypeOf<GwenIntrospection["entity"]>().parameters.toEqualTypeOf<[bigint]>();
    expectTypeOf<EntityId>().toExtend<Parameters<GwenIntrospection["entity"]>[0]>();
    expectTypeOf<GwenIntrospection["entity"]>().returns.toEqualTypeOf<
      GwenIntrospectionEntity | undefined
    >();
  });

  it("GwenIntrospectionEntityPage has the four read-only page fields", () => {
    expectTypeOf<GwenIntrospectionEntityPage>().toEqualTypeOf<{
      readonly available: boolean;
      readonly total: number;
      readonly listed: number;
      readonly items: readonly GwenIntrospectionEntity[];
    }>();
  });
});
