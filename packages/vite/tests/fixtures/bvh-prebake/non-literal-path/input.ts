import { useMeshCollider } from "@gwenjs/physics3d";
const path = "./v.glb";
export const fromVar = useMeshCollider(path);
export const fromTpl = useMeshCollider(`./v-${"x"}.glb`);
export const gltf = useMeshCollider("./x.gltf");
export const remote = useMeshCollider("https://a/x.glb");
export const abs = useMeshCollider("/abs.glb");
export const anchor = useMeshCollider("./anchor.glb");
export const value = 1 + /*@map*/ kept;
