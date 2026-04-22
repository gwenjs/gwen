import type { GwenModule } from "@gwenjs/schema";
import { TweenPlugin, type TweenPluginOptions } from "./engine-plugin.js";

// @ts-expect-error augmenting @gwenjs/app from @gwenjs/core (intentional, activated at app build time)
declare module "@gwenjs/app" {
  interface GwenModuleOptions {
    /** Options for the built-in tween system. */
    tween?: TweenPluginOptions;
  }
}

export default {
  meta: { name: "@gwenjs/core:tween", configKey: "tween" },
  defaults: { poolSize: 256 } satisfies TweenPluginOptions,
  setup(opts: TweenPluginOptions, gwen) {
    gwen.addPlugin(TweenPlugin(opts));
    gwen.addAutoImports([
      { name: "useTween", from: "@gwenjs/core/actor" },
      { name: "defineSequence", from: "@gwenjs/core/actor" },
    ]);
  },
} satisfies GwenModule<TweenPluginOptions>;
