import type { GwenExtensionService } from "@gwenjs/schema";

export declare const marker: number;
export declare const cameraExtension: number;
export type Marker = number;

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "fixture-base:extension": GwenExtensionService;
  }
  interface GwenRuntimeHooks {
    "fixture-base:ready": () => void;
  }
  interface GwenPluginRegistry {
    "fixture-base": {
      readonly extensionApi: { readonly major: 1; readonly minor: 0 };
    };
  }
}
