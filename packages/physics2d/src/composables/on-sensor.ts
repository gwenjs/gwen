/**
 * @file onSensorEnter() / onSensorExit() — sensor overlap event composables.
 */

/** @internal Enter callbacks: sensorId → callbacks */
const _enterCallbacks = new Map<number, ((entityId: bigint) => void)[]>();
/** @internal Exit callbacks: sensorId → callbacks */
const _exitCallbacks = new Map<number, ((entityId: bigint) => void)[]>();

/** @internal Called by physics2d plugin per-frame for sensor enter events. */
export function _dispatchSensorEnter(sensorId: number, entityId: bigint): void {
  const cbs = _enterCallbacks.get(sensorId);
  if (cbs) for (const cb of cbs) cb(entityId);
}

/** @internal Called by physics2d plugin per-frame for sensor exit events. */
export function _dispatchSensorExit(sensorId: number, entityId: bigint): void {
  const cbs = _exitCallbacks.get(sensorId);
  if (cbs) for (const cb of cbs) cb(entityId);
}

/**
 * Remove all sensor callbacks registered for the given sensor ID.
 * Should be called when an actor owning the sensor is despawned to prevent memory leaks.
 *
 * @param sensorId - The sensor collider ID whose callbacks should be cleared.
 * @internal
 */
export function _clearSensorCallbacks(sensorId: number): void {
  _enterCallbacks.delete(sensorId);
  _exitCallbacks.delete(sensorId);
}

/**
 * Subscribes to sensor overlap entry events.
 *
 * Fires when another entity begins overlapping the specified sensor collider.
 *
 * @param sensorId - The collider ID returned by a collider composable with `isSensor: true`.
 * @param callback - Called with the entity ID of the overlapping entity.
 * @returns {void}
 *
 * @example
 * ```typescript
 * const zone = useSphereCollider({ radius: 64, isSensor: true })
 * onSensorEnter(zone.colliderId, (playerId) => {
 *   emit('npc:player-nearby', { npcId: currentEntityId, playerId })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function onSensorEnter(sensorId: number, callback: (entityId: bigint) => void): void {
  if (!_enterCallbacks.has(sensorId)) _enterCallbacks.set(sensorId, []);
  _enterCallbacks.get(sensorId)!.push(callback);
}

/**
 * Subscribes to sensor overlap exit events.
 *
 * Fires when another entity stops overlapping the specified sensor collider.
 *
 * @param sensorId - The collider ID returned by a collider composable with `isSensor: true`.
 * @param callback - Called with the entity ID of the departing entity.
 * @returns {void}
 *
 * @example
 * ```typescript
 * onSensorExit(zone.colliderId, () => {
 *   emit('npc:player-left', { npcId: currentEntityId })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function onSensorExit(sensorId: number, callback: (entityId: bigint) => void): void {
  if (!_exitCallbacks.has(sensorId)) _exitCallbacks.set(sensorId, []);
  _exitCallbacks.get(sensorId)!.push(callback);
}
