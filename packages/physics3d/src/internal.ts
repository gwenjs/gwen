/**
 * @gwenjs/physics3d/internal — no semver guarantee.
 * Framework packages and generated code only.
 */

export { _clearBvhCache } from "./plugin/bvh";
export { EVENT_STRIDE_3D, MAX_EVENTS_3D, COLLIDER_ID_ABSENT } from "./plugin/constants";
export { normalizePhysics3DConfig, QUALITY_PRESETS } from "./config";
export {
  _dispatchContactEvent,
  _clearContactCallbacks,
  _dispatchSensorEnter,
  _dispatchSensorExit,
  _clearSensorCallbacks,
} from "./composables/index";
