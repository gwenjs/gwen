/**
 * @file MockSizeProvider — controllable size provider for tests.
 *
 * @example
 * ```ts
 * import { MockSizeProvider } from '@gwenjs/renderer-core/testing'
 *
 * const provider = MockSizeProvider({ width: 800, height: 600 })
 *
 * // In test: simulate a resize
 * provider.emit(1024, 768)
 * expect(screen.pixels.width).toBe(1024)
 * ```
 */

import type { ScreenSizeProvider } from "../screen-size-providers.js";

/** A `ScreenSizeProvider` with an `emit()` method for simulating resize events in tests. */
export interface MockSizeProviderHandle extends ScreenSizeProvider {
  /** Simulate a container resize event with the given dimensions. */
  emit(width: number, height: number): void;
}

/**
 * Create a controllable `ScreenSizeProvider` for use in tests.
 *
 * @param initial - Starting dimensions.
 * @returns A provider with an `emit(w, h)` method to simulate resize events.
 *
 * @example
 * ```ts
 * const provider = MockSizeProvider({ width: 800, height: 600 })
 * await engine.use(ScreenPlugin({ sizeProvider: provider }))
 *
 * provider.emit(1920, 1080)
 * expect(screen.pixels.width).toBe(1920)
 * ```
 */
export function MockSizeProvider(initial: {
  width: number;
  height: number;
}): MockSizeProviderHandle {
  let _current = { ...initial };
  let _callback: ((w: number, h: number) => void) | undefined;

  const provider: MockSizeProviderHandle = {
    getSize() {
      return { ..._current };
    },
    subscribe(callback) {
      _callback = callback;
      return () => {
        _callback = undefined;
      };
    },
    emit(width, height) {
      _current = { width, height };
      _callback?.(width, height);
    },
  };

  return provider;
}
