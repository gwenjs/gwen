import type { GwenModule } from "@gwenjs/schema";

declare module "@gwenjs/schema" {
  interface GwenModuleOptions {
    scene?: Record<string, never>; // reserved — no options yet
  }
}

export default {
  meta: { name: "@gwenjs/core:scene" },
  setup(_opts, gwen) {
    gwen.addPlugin({ src: "@gwenjs/core/internal", export: "SceneEnginePlugin" });
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
