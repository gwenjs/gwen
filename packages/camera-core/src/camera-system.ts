// packages/camera-core/src/camera-system.ts
/**
 * @file CameraSystem — single orchestrator for all camera entities.
 *
 * Pipeline per frame (onAfterUpdate):
 *   1. clearFrame() on CameraManager so stale states don't persist
 *   2. For each active camera entity:
 *      a. Apply FollowTarget (lerp toward target)  — or —
 *         Advance CameraPath (interpolate waypoints)
 *      b. Clamp to CameraBounds
 *      c. Apply CameraShake offset (does NOT write Camera.x/y/z)
 *      d. Push CameraState to CameraManager
 *   3. Detect semantic changes per viewport and emit camera:* hooks
 */

import { defineSystem, onAfterUpdate, useQuery } from "@gwenjs/core/system";
import { useEngine } from "@gwenjs/core";
import { useCameraManager, useViewportManager } from "@gwenjs/renderer-core";
import type { CameraState } from "@gwenjs/renderer-core";
import { Camera, FollowTarget, CameraBounds, CameraShake, CameraPath } from "./components.js";
import { cameraViewportMap } from "./camera-viewport-map.js";
import { cameraPathStore } from "./camera-path-store.js";

// Noise function for shake offset — simple deterministic pseudo-random based on trauma
function shakeOffset(trauma: number, seed: number): number {
  return Math.sin(seed * 127.1 + trauma * 311.7) * trauma * trauma;
}

// frame counter used as seed for shake noise
let _frame = 0;

export const CameraSystem = defineSystem("CameraSystem", () => {
  const engine = useEngine();
  const cameras = useCameraManager();
  const _viewports = useViewportManager();

  const cameraQuery = useQuery([Camera]);

  // per-viewport tracking for semantic hook emission
  const activeEntityPerViewport = new Map<string, number>(); // viewportId → entityId

  onAfterUpdate((dt) => {
    _frame++;
    const dtSeconds = dt / 1000;

    cameras.clearFrame();

    for (const entity of cameraQuery) {
      const id = entity.id;
      const cam = engine.getComponent(id, Camera);
      if (!cam || cam.active !== 1) continue;

      const viewportId = cameraViewportMap.get(id);
      if (!viewportId) continue;

      let x = cam.x;
      let y = cam.y;
      let z = cam.z;

      // ── Step 1: base position ──────────────────────────────────────────────

      const hasFollow = engine.hasComponent(id, FollowTarget);
      const hasPath = cameraPathStore.has(id);

      if (hasFollow) {
        const follow = engine.getComponent(id, FollowTarget)!;
        const targetId = follow.entityId as number;
        const targetCam = engine.getComponent(targetId, Camera);
        if (targetCam) {
          const tx = targetCam.x + follow.offsetX;
          const ty = targetCam.y + follow.offsetY;
          const tz = targetCam.z + follow.offsetZ;
          x = x + (tx - x) * follow.lerp;
          y = y + (ty - y) * follow.lerp;
          z = z + (tz - z) * follow.lerp;
          engine.addComponent(id, Camera, { ...cam, x, y, z });
        }
      } else if (hasPath) {
        const pathData = cameraPathStore.get(id)!;
        const pathComp = engine.getComponent(id, CameraPath)!;
        const wp = pathData.waypoints[pathComp.index as number];
        if (wp) {
          pathData.elapsed += dtSeconds;
          const progress = Math.min(pathData.elapsed / wp.duration, 1);
          engine.addComponent(id, CameraPath, { ...pathComp, progress });
          if (progress >= 1) {
            x = wp.position.x;
            y = wp.position.y;
            z = wp.position.z;
            engine.addComponent(id, Camera, { ...cam, x, y, z });
            const nextIndex = (pathComp.index as number) + 1;
            if (nextIndex < pathData.waypoints.length) {
              engine.addComponent(id, CameraPath, { ...pathComp, index: nextIndex, progress: 0 });
              pathData.elapsed = 0;
            } else if (pathData.opts.loop) {
              engine.addComponent(id, CameraPath, { ...pathComp, index: 0, progress: 0 });
              pathData.elapsed = 0;
              pathData.opts.onWaypoint?.(nextIndex - 1);
            } else {
              pathData.opts.onComplete?.();
              cameraPathStore.delete(id);
            }
          } else {
            const prevWp = pathData.waypoints[(pathComp.index as number) - 1];
            if (prevWp) {
              x = prevWp.position.x + (wp.position.x - prevWp.position.x) * progress;
              y = prevWp.position.y + (wp.position.y - prevWp.position.y) * progress;
              z = prevWp.position.z + (wp.position.z - prevWp.position.z) * progress;
              engine.addComponent(id, Camera, { ...cam, x, y, z });
            }
          }
        }
      }

      // ── Step 2: bounds clamp ───────────────────────────────────────────────

      if (engine.hasComponent(id, CameraBounds)) {
        const bounds = engine.getComponent(id, CameraBounds)!;
        x = Math.max(bounds.minX, Math.min(bounds.maxX, x));
        y = Math.max(bounds.minY, Math.min(bounds.maxY, y));
        z = Math.max(bounds.minZ, Math.min(bounds.maxZ, z));
        engine.addComponent(id, Camera, { ...cam, x, y, z });
      }

      // ── Step 3: shake offset ───────────────────────────────────────────────

      let shakeX = 0;
      let shakeY = 0;
      const shake = engine.getComponent(id, CameraShake);

      if (shake && shake.trauma > 0) {
        shakeX = shakeOffset(shake.trauma, _frame) * shake.maxX;
        shakeY = shakeOffset(shake.trauma, _frame + 100) * shake.maxY;
        const newTrauma = Math.max(0, shake.trauma - shake.decay * dtSeconds);
        engine.addComponent(id, CameraShake, { ...shake, trauma: newTrauma });
      }

      // ── Step 4: push to CameraManager ─────────────────────────────────────

      const freshCam = engine.getComponent(id, Camera) ?? cam;
      const projection: CameraState["projection"] =
        freshCam.projectionType === 0
          ? {
              type: "orthographic",
              zoom: freshCam.zoom,
              near: freshCam.near,
              far: freshCam.far,
            }
          : {
              type: "perspective",
              fov: freshCam.fov,
              near: freshCam.near,
              far: freshCam.far,
            };

      cameras.set(viewportId, {
        worldTransform: {
          position: {
            x: x + shakeX,
            y: y + shakeY,
            z,
          },
          rotation: {
            x: freshCam.rotX,
            y: freshCam.rotY,
            z: freshCam.rotZ,
          },
        },
        projection,
        viewportId,
        active: true,
        priority: freshCam.priority,
      });
    }

    // ── Step 5: semantic hook emission ────────────────────────────────────────

    const currentActivePerViewport = new Map<string, number>();

    for (const entity of cameraQuery) {
      const id = entity.id;
      const cam = engine.getComponent(id, Camera);
      if (!cam || cam.active !== 1) continue;
      const viewportId = cameraViewportMap.get(id);
      if (!viewportId) continue;
      if (!cameras.get(viewportId)) continue;
      const existing = currentActivePerViewport.get(viewportId);
      const existingPriority =
        existing !== undefined
          ? (engine.getComponent(existing, Camera)?.priority ?? -Infinity)
          : -Infinity;
      if (cam.priority >= existingPriority) {
        currentActivePerViewport.set(viewportId, id);
      }
    }

    for (const [viewportId, entityId] of currentActivePerViewport) {
      const prev = activeEntityPerViewport.get(viewportId);
      if (prev === undefined) {
        void engine.hooks.callHook("camera:activate", { viewportId, entityId });
      } else if (prev !== entityId) {
        void engine.hooks.callHook("camera:switch", { viewportId, from: prev, to: entityId });
      }
      activeEntityPerViewport.set(viewportId, entityId);
    }

    for (const [viewportId] of activeEntityPerViewport) {
      if (!currentActivePerViewport.has(viewportId)) {
        activeEntityPerViewport.delete(viewportId);
        void engine.hooks.callHook("camera:deactivate", { viewportId });
      }
    }
  });
});
