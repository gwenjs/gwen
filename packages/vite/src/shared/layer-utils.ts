/**
 * @file Public entry for the layer-inline transform.
 *
 * Re-exports `layerInlineTransform` and `evalConstInt`. Physics Vite plugins
 * register the unit from `@gwenjs/vite/shared/layer-utils`.
 */

export { layerInlineTransform, evalConstInt } from "../transforms/layer-inline.js";
