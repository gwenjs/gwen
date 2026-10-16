import { expectTypeOf } from "vitest";

import type { GwenEngine } from "../../src/index";

type IfEquals<X, Y, A = true, B = false> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? A : B;

type ReadonlyKey<T, K extends keyof T> = IfEquals<
  { [P in K]: T[P] },
  { -readonly [P in K]: T[P] },
  false,
  true
>;

type FrameWritesRejected = ReadonlyKey<GwenEngine["frame"], "alpha"> &
  ReadonlyKey<GwenEngine["frame"], "fixedStep"> &
  ReadonlyKey<GwenEngine["frame"], "steps"> &
  ReadonlyKey<GwenEngine["frame"], "rendering"> &
  ReadonlyKey<GwenEngine["frame"], "transforms2D">;

expectTypeOf<FrameWritesRejected>().toEqualTypeOf<true>();
