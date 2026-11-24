import { defineLayers } from "other-lib";
import { defineLayers as real } from "@gwenjs/physics2d";
export const layers = real;
export const Foreign = defineLayers({ anchor: 1 });
export const foreignRef = Foreign.anchor;
const L = real({ anchor: 1 });
export const value = L.anchor + /*@map*/ kept;
