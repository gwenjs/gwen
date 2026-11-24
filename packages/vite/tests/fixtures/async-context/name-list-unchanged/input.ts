import { onUpdate } from "@gwenjs/core/system";
import { onEnter, onTransitionEnter, onTransitionExit } from "@gwenjs/core/scene";

onUpdate(async () => {
  await frame();
});

onTransitionExit(async () => {
  await leave();
});

onTransitionEnter(async () => {
  await enterScene();
});

onEnter(async () => {
  await load(/*@map*/ mark);
});
