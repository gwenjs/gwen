import { defineLayers } from "@gwenjs/physics2d";
const k = "anchor";
const extra = { wall: 2 };
const Broken = defineLayers({ [k]: 1, ...extra });
export const brokenRef = Broken.anchor;
const L = defineLayers({ anchor: 1 });
export const value = L.anchor + /*@map*/ kept;
