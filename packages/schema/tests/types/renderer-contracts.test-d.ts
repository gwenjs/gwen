import { describe, expectTypeOf, it } from "vitest";
import type {
  CameraStateStore,
  GwenProvides,
  GwenRuntimeHooks,
  LayerDef,
  LayerHost,
  RendererService,
  ScreenInfoStore,
  ViewportRegion,
  ViewportStore,
} from "@gwenjs/schema";

describe("renderer contracts", () => {
  it("the four host keys of GwenProvides are typed by schema interfaces", () => {
    expectTypeOf<GwenProvides["cameraManager"]>().toEqualTypeOf<CameraStateStore>();
    expectTypeOf<GwenProvides["layerManager"]>().toEqualTypeOf<LayerHost>();
    expectTypeOf<GwenProvides["screenService"]>().toEqualTypeOf<ScreenInfoStore>();
    expectTypeOf<GwenProvides["viewportManager"]>().toEqualTypeOf<ViewportStore>();
  });

  it("RendererService.resize takes (width, height, dpr) and a two-parameter implementation stays assignable; LayerDef accepts parallax", () => {
    expectTypeOf<RendererService["resize"]>().parameters.toEqualTypeOf<[number, number, number]>();

    class TwoParamRenderer implements RendererService {
      readonly name = "renderer:two";
      readonly contractVersion = 2;
      readonly layers: RendererService["layers"] = { game: { order: 1 } };
      mount(_container: HTMLElement): void {}
      unmount(): void {}
      resize(_width: number, _height: number): void {}
      getLayerElement(_layerName: string): HTMLElement {
        return document.createElement("div");
      }
    }

    type TwoParamAssignable = TwoParamRenderer extends RendererService ? true : false;
    expectTypeOf<TwoParamAssignable>().toEqualTypeOf<true>();

    const withParallax = {
      order: 1,
      parallax: { x: 0.5, y: -1 },
    } satisfies LayerDef;
    expectTypeOf(withParallax.order).toEqualTypeOf<number>();
    expectTypeOf<LayerDef["parallax"]>().toEqualTypeOf<
      { readonly x: number; readonly y: number } | undefined
    >();
  });

  it("viewport:add, viewport:resize and viewport:remove payloads are typed from schema", () => {
    expectTypeOf<GwenRuntimeHooks["viewport:add"]>().parameters.toEqualTypeOf<
      [{ id: string; region: ViewportRegion }]
    >();
    expectTypeOf<GwenRuntimeHooks["viewport:resize"]>().parameters.toEqualTypeOf<
      [{ id: string; region: ViewportRegion }]
    >();
    expectTypeOf<GwenRuntimeHooks["viewport:remove"]>().parameters.toEqualTypeOf<
      [{ id: string }]
    >();
  });
});
