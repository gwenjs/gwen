export const router = {
  onEnter(cb: () => number) {
    return cb();
  },
};

export class Box {
  defineSystem(): number {
    return 1;
  }

  run(): number {
    return this.defineSystem();
  }
}

export const entered = router.onEnter(() => 1);
export const box = new Box();
export const ran = box.run();
import * as G from "@gwenjs/core/system";
export const Anchor = G.defineSystem(() => 1);
