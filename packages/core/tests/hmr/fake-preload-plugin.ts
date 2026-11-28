/** Stand-in preload plugin: tests add a scene name to `ready` from `onPreload`. */
export function fakePreload(): { readonly ready: Set<string> } {
  return { ready: new Set<string>() };
}
