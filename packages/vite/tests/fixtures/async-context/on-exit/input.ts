import { onExit } from "@gwenjs/core/scene";

onExit(async () => {
  await save(/*@map*/ mark);
});
