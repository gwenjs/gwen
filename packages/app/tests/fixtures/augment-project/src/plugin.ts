import { definePlugin } from "@gwenjs/kit/plugin";

export const FixturePlugin = definePlugin(() => ({
  name: "fixture",
  setup(engine) {
    engine.hooks.hook("game:over", (score) => {
      const n: number = score;
      return n;
    });
  },
}));
