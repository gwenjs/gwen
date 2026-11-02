/**
 * @file Assets contract.
 *
 * Types only. A loader package provides the service and extends {@link AssetValueMap}
 * by declaration merging on `@gwenjs/schema`. This module has no runtime value.
 *
 * @module
 */

/**
 * Built-in asset kinds, plus any other string a loader names.
 * `"image"`, `"audio"` and `"json"` are the built-ins. A custom kind is any other string.
 */
export type AssetKind = "image" | "audio" | "json" | (string & {});

/**
 * Handle of one asset. `K` is the kind.
 * A renderer or a scene holds the ref. The loader that owns the bytes extends the value side.
 */
export interface AssetRef<K extends AssetKind = AssetKind> {
  readonly kind: K;
  readonly key: string;
  readonly url: string;
}

/**
 * Maps a kind to the value a loader returns.
 * A loader extends this interface by declaration merging on `"@gwenjs/schema"`.
 *
 * @example
 * ```ts
 * declare module "@gwenjs/schema" {
 *   interface AssetValueMap {
 *     mesh: { vertices: Float32Array };
 *   }
 * }
 * ```
 */
export interface AssetValueMap {
  image: ImageBitmap | HTMLImageElement;
  audio: AudioBuffer;
  json: unknown;
}

/**
 * Loaded value of kind `K`.
 * A kind with no entry on {@link AssetValueMap} reads as `unknown`.
 * A loader does not replace this alias. It extends {@link AssetValueMap} on `"@gwenjs/schema"`.
 */
export type AssetValue<K extends AssetKind> = K extends keyof AssetValueMap
  ? AssetValueMap[K]
  : unknown;

/**
 * Registry a loader provides. Game code reads it with `engine.inject('assets')`.
 * This package declares the slot. The loader package supplies the value.
 */
export interface AssetsService {
  /** True once the asset is loaded. Never throws. */
  has(ref: AssetRef): boolean;

  /**
   * Loaded value of `ref`.
   * Throws when the asset is not loaded yet. The code is ASSETS:NOT_LOADED.
   * That constant lives in `@gwenjs/assets`. This package does not declare it.
   */
  get<K extends AssetKind>(ref: AssetRef<K>): AssetValue<K>;
}
