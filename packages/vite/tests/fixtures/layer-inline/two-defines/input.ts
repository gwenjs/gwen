import { defineLayers } from "@gwenjs/physics2d";
const Gone = defineLayers({ anchor: 1 });
const Kept = defineLayers({ anchor: 2, k: 3 });
export function take(value: unknown) {
  return value;
}
export const passed = take(Kept);
export const value = Gone.anchor + Kept.k + /*@map*/ kept;
