import { describe, expectTypeOf, it } from "vitest";
import type { AssetKind, AssetRef, AssetValue, AssetsService, GwenProvides } from "@gwenjs/schema";

declare module "@gwenjs/schema" {
  interface AssetValueMap {
    mesh: { vertices: Float32Array };
  }
}

describe("assets contract", () => {
  it("AssetValue of audio is AudioBuffer", () => {
    expectTypeOf<AssetValue<"audio">>().toEqualTypeOf<AudioBuffer>();
  });

  it("AssetValue of image is ImageBitmap or HTMLImageElement", () => {
    expectTypeOf<AssetValue<"image">>().toEqualTypeOf<ImageBitmap | HTMLImageElement>();
  });

  it("GwenProvides assets is AssetsService", () => {
    expectTypeOf<GwenProvides["assets"]>().toEqualTypeOf<AssetsService>();
  });

  it("an image ref is not assignable to an audio ref", () => {
    expectTypeOf<AssetRef<"image">>().not.toExtend<AssetRef<"audio">>();
  });

  it("an augmentation of AssetValueMap narrows AssetValue of a custom kind", () => {
    expectTypeOf<AssetValue<"mesh">>().toEqualTypeOf<{ vertices: Float32Array }>();
  });

  it("AssetValue of an undeclared custom kind is unknown", () => {
    expectTypeOf<AssetValue<"font">>().toEqualTypeOf<unknown>();
  });

  it("AssetValue of json is unknown", () => {
    expectTypeOf<AssetValue<"json">>().toEqualTypeOf<unknown>();
  });

  it("AssetRef fields are readonly", () => {
    expectTypeOf<AssetRef<"audio">>().toEqualTypeOf<Readonly<AssetRef<"audio">>>();
  });

  it("AssetsService has and get take a ref and read the value type of its kind", () => {
    interface ExpectedAssetsService {
      has(ref: AssetRef): boolean;
      get<K extends AssetKind>(ref: AssetRef<K>): AssetValue<K>;
    }
    expectTypeOf<AssetsService>().toEqualTypeOf<ExpectedAssetsService>();
  });
});
