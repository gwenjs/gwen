import type { GwenModule } from "@gwenjs/schema";

declare module "@gwenjs/schema" {
  interface GwenModuleOptions {
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
      { name: "useComponentFor", from: "@gwenjs/core/system" },
    ]);
  },
} satisfies GwenModule;
