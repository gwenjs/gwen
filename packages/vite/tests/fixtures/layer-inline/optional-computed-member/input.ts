import { defineLayers } from "@gwenjs/physics2d";
export const layers = defineLayers;
export const k = "a";
const L = defineLayers({ a: 1, b: 2, k: 3 });
export const optional = L?.a;
export const computedString = L["a"];
export const computedVar = L[k];
export const value = L.b + /*@map*/ kept;
