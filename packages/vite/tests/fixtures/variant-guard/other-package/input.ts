import { defineSystem } from "@gwenjs/core/system";
import { Renderer } from "@gwenjs/renderer-core";
import { defineConfig } from "vite";
import { useRaycast } from "@gwenjs/physics3d"; // offender
export const s = defineSystem;
export const g = Renderer;
export const c = defineConfig;
export const r = useRaycast;
