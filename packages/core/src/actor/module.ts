import type { GwenModule } from "@gwenjs/schema";

// @ts-expect-error augmenting @gwenjs/app from @gwenjs/core (intentional, activated at app build time)
declare module "@gwenjs/app" {
  interface GwenUserConfig {
    actor?: {
      /** Warn in dev when actors are likely leaking. @default true */
      warnOnLeak?: boolean;
    };
  }
}

export default {
  meta: { name: "@gwenjs/core:actor" },
  setup(_opts, gwen) {
    gwen.addAutoImports([
      { name: "defineActor", from: "@gwenjs/core/actor" },
      { name: "definePrefab", from: "@gwenjs/core/actor" },
      { name: "onStart", from: "@gwenjs/core/actor" },
      { name: "onDestroy", from: "@gwenjs/core/actor" },
      { name: "onEnable", from: "@gwenjs/core/actor" },
      { name: "onDisable", from: "@gwenjs/core/actor" },
      { name: "onEvent", from: "@gwenjs/core/actor" },
      { name: "useActor", from: "@gwenjs/core/actor" },
      { name: "useTransform", from: "@gwenjs/core/actor" },
      { name: "useComponent", from: "@gwenjs/core/actor" },
      { name: "useEntityId", from: "@gwenjs/core/actor" },
      { name: "usePrefab", from: "@gwenjs/core/actor" },
      { name: "defineActorPool", from: "@gwenjs/core/actor" },
      { name: "useActorPool", from: "@gwenjs/core/actor" },
      { name: "defineLayout", from: "@gwenjs/core/actor" },
      { name: "useLayout", from: "@gwenjs/core/actor" },
      { name: "placeActor", from: "@gwenjs/core/actor" },
      { name: "placeGroup", from: "@gwenjs/core/actor" },
      { name: "placePrefab", from: "@gwenjs/core/actor" },
      { name: "defineEvents", from: "@gwenjs/core/actor" },
    ]);
  },
} satisfies GwenModule;
