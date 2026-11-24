import { defineLayers } from "@gwenjs/physics2d";
import { onEnter } from "@gwenjs/core/scene";

export const layers = defineLayers;
const Layers = defineLayers({ wall: 4 });

onEnter(async () => {
  const value = await load(Layers.wall + /*@map*/ mark);
  await next();
  report(value);
});
