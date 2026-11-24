import { onEnter } from "@gwenjs/core/scene";

onEnter(async () => {
  await load(await read());
});
