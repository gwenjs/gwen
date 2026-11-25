import type { Body } from "@gwenjs/physics3d";
import type * as P3 from "@gwenjs/physics3d";
import { useRaycast } from "@gwenjs/physics3d"; // offender
export type Both = [Body, P3.Shape];
export const r = useRaycast;
