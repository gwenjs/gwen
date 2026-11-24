import { defineLayers } from "@gwenjs/physics2d";
export const layers = defineLayers;
const L = defineLayers({ a: 1, b: 2 });
export function assign(
  o: { p: number },
  arr: number[],
  list: number[],
  obj: Record<string, number>,
): number {
  ({ p: L.a } = o);
  [L.a] = arr;
  [L.a = 0] = arr;
  ({ p: L.a = 0 } = o);
  ({ ...L.a } = o);
  for (L.a of list) {
    break;
  }
  for (L.a in obj) {
    break;
  }
  return 2 + /*@map*/ kept;
}
