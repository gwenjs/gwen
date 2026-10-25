import { describe, expectTypeOf, it } from "vitest";
import type {
  CameraManager,
  CameraState,
  ScreenService,
  ViewportContext,
  ViewportManager,
} from "@gwenjs/renderer-core";
import type {
  CameraState as SchemaCameraState,
  CameraStateStore,
  ScreenInfoStore,
  ViewportContext as SchemaViewportContext,
  ViewportStore,
} from "@gwenjs/schema";

describe("schema contracts", () => {
  it("renderer-core CameraManager / ViewportManager / ScreenService / CameraState / ViewportContext are the schema types", () => {
    expectTypeOf<CameraManager>().toEqualTypeOf<CameraStateStore>();
    expectTypeOf<ViewportManager>().toEqualTypeOf<ViewportStore>();
    expectTypeOf<ScreenService>().toEqualTypeOf<ScreenInfoStore>();
    expectTypeOf<CameraState>().toEqualTypeOf<SchemaCameraState>();
    expectTypeOf<ViewportContext>().toEqualTypeOf<SchemaViewportContext>();
  });
});
