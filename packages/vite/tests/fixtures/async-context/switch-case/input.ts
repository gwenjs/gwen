import { onEnter } from "@gwenjs/core/scene";

onEnter(async () => {
  switch (kind) {
    case 1:
      await load(/*@map*/ mark);
      break;
  }
});
