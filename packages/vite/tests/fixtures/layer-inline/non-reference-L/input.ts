import { defineLayers } from "@gwenjs/physics2d";
export const layers = defineLayers;
const L = defineLayers({ b: 1 });
export const key = { L: 1 };
export const point = { x: 0 };
export const prop = point.L;
export function labeled(): void {
  L: for (;;) {
    break L;
  }
}
export const value = L.b + /*@map*/ kept;
