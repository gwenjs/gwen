/**
 * @file writeCameraViews — fill caller-owned RenderView slots from camera state.
 *
 * Non-XR only. XR eye matrices live in `getCameraStores(engine).matrices`.
 * Matrices are column-major Float32Arrays. `@gwenjs/math` Mat4 is not used here.
 */

import type { GwenEngine } from "@gwenjs/core";
import type { CameraState, ViewportContext } from "./camera-types.js";
import type { ScreenService } from "./screen-service.js";
import type { RenderView } from "./types.js";

/**
 * Fill `out` from cameras, viewports, and screen info.
 * Returns how many active cameras were seen, including slots that were not written.
 * Does not push onto `out` and does not replace matrix or pixelRect objects.
 *
 * A short `out`, or a slot whose matrices are shorter than 16, is still counted
 * and left unchanged. The returned count can therefore include a stale or missing
 * view. Size `out` and both matrices to length 16 before reading the slots.
 */
export function writeCameraViews(engine: GwenEngine, out: RenderView[]): number {
  const viewports = engine.tryInject("viewportManager");
  const cameras = engine.tryInject("cameraManager");
  const screen = engine.tryInject("screenService");
  if (viewports === undefined || cameras === undefined || screen === undefined) return 0;

  let count = 0;
  for (const viewport of viewports.getAll().values()) {
    const camera = cameras.get(viewport.id);
    if (camera === undefined || !camera.active) continue;
    const slot = out[count];
    if (slot !== undefined && canWrite(slot)) {
      writeOne(slot, viewport, camera, screen);
    }
    count += 1;
  }
  return count;
}

function canWrite(slot: RenderView): boolean {
  return slot.viewMatrix.length >= 16 && slot.projectionMatrix.length >= 16;
}

function writeOne(
  slot: RenderView,
  viewport: ViewportContext,
  camera: CameraState,
  screen: ScreenService,
): void {
  const info = screen.getOrCreateInfo(viewport.id);
  const cssW = info.pixels.width;
  const cssH = info.pixels.height;
  const dpr = info.dpr;
  const region = viewport.region;

  slot.viewportId = viewport.id;
  slot.eye = "none";
  slot.pixelRect.x = (region.width !== 0 ? (region.x / region.width) * cssW : 0) * dpr;
  slot.pixelRect.y = (region.height !== 0 ? (region.y / region.height) * cssH : 0) * dpr;
  slot.pixelRect.width = cssW * dpr;
  slot.pixelRect.height = cssH * dpr;

  const { x, y, z } = camera.worldTransform.position;
  const rotation = camera.worldTransform.rotation;
  writeViewMatrix(x, y, z, rotation.x, rotation.y, rotation.z, slot.viewMatrix);

  const projection = camera.projection;
  if (projection.type === "perspective") {
    const aspect = cssH !== 0 ? cssW / cssH : 1;
    writePerspective(
      projection.fov,
      aspect,
      projection.near,
      projection.far,
      slot.projectionMatrix,
    );
    return;
  }
  writeOrtho(cssW, cssH, projection.zoom, projection.near, projection.far, slot.projectionMatrix);
}

/** Negate and collapse -0 so an identity view stays positive zero. */
function negate(n: number): number {
  const v = -n;
  return v === 0 ? 0 : v;
}

/** Column-major world→view. Euler order is YXZ, matching `quatFromEuler`. */
function writeViewMatrix(
  px: number,
  py: number,
  pz: number,
  ex: number,
  ey: number,
  ez: number,
  out: Float32Array,
): void {
  const cx = Math.cos(ex * 0.5);
  const sx = Math.sin(ex * 0.5);
  const cy = Math.cos(ey * 0.5);
  const sy = Math.sin(ey * 0.5);
  const cz = Math.cos(ez * 0.5);
  const sz = Math.sin(ez * 0.5);
  const qx = sx * cy * cz + cx * sy * sz;
  const qy = cx * sy * cz - sx * cy * sz;
  const qz = cx * cy * sz - sx * sy * cz;
  const qw = cx * cy * cz + sx * sy * sz;

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  const r00 = 1 - (yy + zz);
  const r01 = xy - wz;
  const r02 = xz + wy;
  const r10 = xy + wz;
  const r11 = 1 - (xx + zz);
  const r12 = yz - wx;
  const r20 = xz - wy;
  const r21 = yz + wx;
  const r22 = 1 - (xx + yy);

  const tx = negate(r00 * px + r10 * py + r20 * pz);
  const ty = negate(r01 * px + r11 * py + r21 * pz);
  const tz = negate(r02 * px + r12 * py + r22 * pz);

  out[0] = r00;
  out[1] = r01;
  out[2] = r02;
  out[3] = 0;
  out[4] = r10;
  out[5] = r11;
  out[6] = r12;
  out[7] = 0;
  out[8] = r20;
  out[9] = r21;
  out[10] = r22;
  out[11] = 0;
  out[12] = tx;
  out[13] = ty;
  out[14] = tz;
  out[15] = 1;
}

/** Column-major perspective. Same terms as `mat4Perspective` (depth range [-1, 1]). */
function writePerspective(
  fovY: number,
  aspect: number,
  near: number,
  far: number,
  out: Float32Array,
): void {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = 2 * far * near * nf;
  out[15] = 0;
}

/** Column-major orthographic. Frustum is `pixels / zoom`, centered, matching the bounds provider. */
function writeOrtho(
  cssW: number,
  cssH: number,
  zoom: number,
  near: number,
  far: number,
  out: Float32Array,
): void {
  const halfW = cssW / zoom / 2;
  const halfH = cssH / zoom / 2;
  const left = -halfW;
  const right = halfW;
  const bottom = -halfH;
  const top = halfH;
  const rl = 1 / (right - left);
  const tb = 1 / (top - bottom);
  const fn = 1 / (far - near);
  out[0] = 2 * rl;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = 2 * tb;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = -2 * fn;
  out[11] = 0;
  out[12] = -(right + left) * rl;
  out[13] = -(top + bottom) * tb;
  out[14] = -(far + near) * fn;
  out[15] = 1;
}
