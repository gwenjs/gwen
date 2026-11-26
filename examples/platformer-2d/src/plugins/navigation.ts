import { useHook } from "@gwenjs/core";
import { useSceneRouter } from "@gwenjs/core/scene";
import { definePlugin } from "@gwenjs/kit/plugin";
import { AppRouter } from "../router";

export default definePlugin(() => ({
  name: "example:navigation",
  setup() {
    const nav = useSceneRouter(AppRouter);
    useHook("game:start", () => {
      void nav.send("START");
    });
    useHook("game:interpolation", () => {
      void nav.send("INTERPOLATION");
    });
  },
}));
