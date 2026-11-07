/**
 * Names core runtime tests pass to `requires.plugins`.
 * `major: number` keeps a numeric major assignable in the object form.
 */
// Registers "camera-core" so a test that imports only this file still sees that name.
import "@gwenjs/camera-core";

declare module "@gwenjs/schema" {
  interface GwenPluginRegistry {
    B: {};
    p1: {};
    p2: {};
    missing: {};
    base: { readonly extensionApi: { readonly major: number } };
    gone: { readonly extensionApi: { readonly major: number } };
    E1: { readonly extensionApi: { readonly major: number } };
  }
}

export {};
