import { defineLayers } from "@gwenjs/physics2d";
export const layers = defineLayers;
const L = defineLayers({ a: 1, b: 2 });
export const text = L.a.toString();
export const valueOf = L.a.valueOf;
export const optional = L.a?.toString();
export const value = L.b + /*@map*/ kept;
