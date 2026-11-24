import { defineLayers } from "@gwenjs/physics2d";
const SOME_CONST = 1;
const Broken = defineLayers({ anchor: 1, wall: SOME_CONST });
export const brokenRef = Broken.anchor + Broken.wall;
const L = defineLayers({ anchor: 2 });
export const value = L.anchor + /*@map*/ kept;
