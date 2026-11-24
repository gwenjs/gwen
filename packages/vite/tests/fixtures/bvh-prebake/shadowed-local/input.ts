import { useMeshCollider } from "@gwenjs/physics3d";
export function inner(useMeshCollider: (path: string) => number) {
  return useMeshCollider("./local.glb");
}
export function nested() {
  function useMeshCollider(path: string): string {
    return path;
  }
  return useMeshCollider("./nested.glb");
}
export const anchor = useMeshCollider("./anchor.glb");
export const value = 1 + /*@map*/ kept;
