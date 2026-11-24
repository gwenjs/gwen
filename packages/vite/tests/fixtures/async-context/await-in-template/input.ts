import { onEnter } from "@gwenjs/core/scene";

onEnter(async () => {
  const label = `asset ${await load(/*@map*/ mark)}`;
  void label;
});
