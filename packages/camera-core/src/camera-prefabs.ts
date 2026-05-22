import { definePrefab } from "@gwenjs/core/actor";
import { Camera, CameraBounds, CameraShake } from "./components";

export const OrthographicCameraPrefab = definePrefab([
  {
    def: Camera,
    defaults: {
      active: 1,
      priority: 0,
      projectionType: 0,
      zoom: 1,
      fov: 0,
      near: 0.1,
      far: 1000,
      x: 0,
      y: 0,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
    },
  },
  {
    def: CameraBounds,
    defaults: {
      minX: -Infinity,
      maxX: Infinity,
      minY: -Infinity,
      maxY: Infinity,
      minZ: -Infinity,
      maxZ: Infinity,
    },
  },
  { def: CameraShake, defaults: { trauma: 0, decay: 1, maxX: 20, maxY: 20 } },
]);

export const PerspectiveCameraPrefab = definePrefab([
  {
    def: Camera,
    defaults: {
      active: 1,
      priority: 0,
      projectionType: 1,
      zoom: 0,
      fov: Math.PI / 3,
      near: 0.1,
      far: 1000,
      x: 0,
      y: 0,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
    },
  },
  {
    def: CameraBounds,
    defaults: {
      minX: -Infinity,
      maxX: Infinity,
      minY: -Infinity,
      maxY: Infinity,
      minZ: -Infinity,
      maxZ: Infinity,
    },
  },
  { def: CameraShake, defaults: { trauma: 0, decay: 1, maxX: 0.05, maxY: 0.05 } },
]);
