import type { GwenModule } from "@gwenjs/schema";

// @ts-expect-error augmenting @gwenjs/app from @gwenjs/core (intentional, activated at app build time)
declare module "@gwenjs/app" {
  interface GwenUserConfig {
    system?: Record<string, never>; // reserved — no options yet
  }
}

export default {
  meta: { name: "@gwenjs/core:system" },
  setup(_opts, gwen) {
    gwen.addAutoImports([
      { name: "defineSystem", from: "@gwenjs/core/system" },
      { name: "onUpdate", from: "@gwenjs/core/system" },
      { name: "onBeforeUpdate", from: "@gwenjs/core/system" },
      { name: "onAfterUpdate", from: "@gwenjs/core/system" },
      { name: "onRender", from: "@gwenjs/core/system" },
      { name: "useQuery", from: "@gwenjs/core/system" },
      { name: "useService", from: "@gwenjs/core/system" },
      { name: "useWasmModule", from: "@gwenjs/core/system" },
    ]);
  },
} satisfies GwenModule;
