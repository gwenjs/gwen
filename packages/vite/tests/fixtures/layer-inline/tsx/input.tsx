import { defineLayers } from "@gwenjs/physics2d";
export const layers = defineLayers;
const L = defineLayers({ anchor: 1 });
export const View = <span data-layer={L.anchor + /*@map*/ kept} />;
