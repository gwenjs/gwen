/**
 * @file onSensorEnter / onSensorExit — register callbacks for sensor zone events.
 */

/** Per-sensor enter callbacks. Key = sensorId. */
const _enterCallbacks = new Map<number, ((entityId: bigint) => void)[]>();
/** Per-sensor exit callbacks. Key = sensorId. */
const _exitCallbacks = new Map<number, ((entityId: bigint) => void)[]>();

/**
 * Register a callback invoked when an entity enters a physics sensor zone.
 *
 * Callbacks are keyed by `sensorId` so that multiple sensors can coexist
 * within the same actor without interfering with one another.
 *
 * @param sensorId - The collider ID of the sensor (from {@link useBoxCollider} or similar).
 * @param callback - Function invoked with the entering entity's packed slot index as a `bigint`.
 *
 * @example
 * ```typescript
 * const TriggerActor = defineActor(TriggerPrefab, () => {
 *   useStaticBody()
 *   const zone = useBoxCollider({ w: 4, h: 2, d: 4, isSensor: true })
 *   onSensorEnter(zone.colliderId, (entityId) => {
 *     console.log('Entity entered:', entityId)
 *   })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function onSensorEnter(sensorId: number, callback: (entityId: bigint) => void): () => void {
  const existing = _enterCallbacks.get(sensorId) ?? [];
  existing.push(callback);
  _enterCallbacks.set(sensorId, existing);
  return () => {
    const cbs = _enterCallbacks.get(sensorId);
    if (!cbs) return;
    const idx = cbs.indexOf(callback);
    if (idx !== -1) cbs.splice(idx, 1);
  };
}

/**
 * Register a callback invoked when an entity exits a physics sensor zone.
 *
 * @param sensorId - The collider ID of the sensor.
 * @param callback - Function invoked with the exiting entity's packed slot index as a `bigint`.
 *
 * @example
 * ```typescript
 * onSensorExit(zone.colliderId, (entityId) => {
 *   console.log('Entity left the zone:', entityId)
 * })
 * ```
 *
 * @since 1.0.0
 */
export function onSensorExit(sensorId: number, callback: (entityId: bigint) => void): () => void {
  const existing = _exitCallbacks.get(sensorId) ?? [];
  existing.push(callback);
  _exitCallbacks.set(sensorId, existing);
  return () => {
    const cbs = _exitCallbacks.get(sensorId);
    if (!cbs) return;
    const idx = cbs.indexOf(callback);
    if (idx !== -1) cbs.splice(idx, 1);
  };
}

/**
 * Dispatch a sensor-enter event to all callbacks registered for `sensorId`.
 *
 * Called by the Physics3D plugin during the `onUpdate` phase.
 *
 * @param sensorId - The collider ID of the sensor that was entered.
 * @param entityId - Packed slot index of the entity that entered.
 * @internal
 */
export function _dispatchSensorEnter(sensorId: number, entityId: bigint): void {
  const cbs = _enterCallbacks.get(sensorId);
  if (cbs) {
    for (const cb of cbs) {
      cb(entityId);
    }
  }
}

/**
 * Dispatch a sensor-exit event to all callbacks registered for `sensorId`.
 *
 * @param sensorId - The collider ID of the sensor that was exited.
 * @param entityId - Packed slot index of the entity that exited.
 * @internal
 */
export function _dispatchSensorExit(sensorId: number, entityId: bigint): void {
  const cbs = _exitCallbacks.get(sensorId);
  if (cbs) {
    for (const cb of cbs) {
      cb(entityId);
    }
  }
}

/**
 * Remove all registered sensor callbacks for all sensors.
 *
 * Used in tests and plugin teardown to reset the callback registries.
 *
 * @internal
 */
export function _clearSensorCallbacks(): void {
  _enterCallbacks.clear();
  _exitCallbacks.clear();
}
