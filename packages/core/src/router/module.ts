import type { GwenModule } from "@gwenjs/schema";

export default {
  meta: { name: "@gwenjs/core:router" },
  setup(_opts, gwen) {
    gwen.addAutoImports([
      { name: "defineSceneRouter", from: "@gwenjs/core/scene" },
      { name: "useSceneRouter", from: "@gwenjs/core/scene" },
    ]);
  },
} satisfies GwenModule;
