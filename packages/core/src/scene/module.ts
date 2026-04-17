import type { GwenModule } from "@gwenjs/schema";
import { SceneEnginePlugin } from "./engine-plugin.js";

// @ts-expect-error augmenting @gwenjs/app from @gwenjs/core (intentional, activated at app build time)
declare module "@gwenjs/app" {
  interface GwenUserConfig {
    scene?: Record<string, never>; // reserved — no options yet
  }
}

export default {
  meta: { name: "@gwenjs/core:scene" },
  setup(_opts, gwen) {
    gwen.addPlugin(SceneEnginePlugin());
    gwen.addAutoImports([
      { name: "defineScene", from: "@gwenjs/core/scene" },
      { name: "useSystem", from: "@gwenjs/core/scene" },
      { name: "onEnter", from: "@gwenjs/core/scene" },
      { name: "onExit", from: "@gwenjs/core/scene" },
      { name: "onTransitionLeave", from: "@gwenjs/core/scene" },
      { name: "onTransitionEnter", from: "@gwenjs/core/scene" },
    ]);
  },
} satisfies GwenModule;
