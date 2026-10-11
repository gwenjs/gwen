/**
 * Schedule the next animation frame.
 * Uses `requestAnimationFrame` on the main thread; falls back to `setTimeout`
 * in Web Worker contexts where RAF is unavailable.
 */
export function scheduleFrame(cb: (time: number) => void): number | ReturnType<typeof setTimeout> {
  if (typeof requestAnimationFrame !== "undefined") {
    return requestAnimationFrame(cb);
  }
  // Worker fallback: no visual sync, but keeps the loop running.
  return setTimeout(() => cb(performance.now()), 0);
}

/** Cancel a previously scheduled frame (RAF or setTimeout handle). */
export function cancelScheduledFrame(handle: number | ReturnType<typeof setTimeout>): void {
  if (typeof cancelAnimationFrame !== "undefined") {
    if (typeof handle === "number") cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}
