import type { GwenModule } from "@gwenjs/schema";
import type { TweenPluginOptions } from "./engine-plugin.js";

declare module "@gwenjs/schema" {
  interface GwenModuleOptions {
    /** Options for the built-in tween system. */
    tween?: TweenPluginOptions;
  }
}

export default {
  meta: { name: "@gwenjs/core:tween", configKey: "tween" },
  defaults: { poolSize: 256 } satisfies TweenPluginOptions,
  setup(opts: TweenPluginOptions, gwen) {
    gwen.addPlugin({ src: "@gwenjs/core/internal", export: "TweenPlugin", options: opts });
    gwen.addAutoImports([
      { name: "useTween", from: "@gwenjs/core/tween" },
      { name: "defineSequence", from: "@gwenjs/core/tween" },
    ]);
  },
} satisfies GwenModule<TweenPluginOptions>;
