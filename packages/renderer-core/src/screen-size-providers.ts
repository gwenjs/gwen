/**
 * @file ScreenSizeProvider — contract and built-in implementations.
 *
 * `ScreenPlugin` delegates all size-detection logic to a `ScreenSizeProvider`.
 * This allows games to run in Node.js, Electron, or any custom environment
 * without coupling the framework to browser APIs.
 *
 * @example Browser (default — zero config)
 * ```ts
 * // Detected automatically by ScreenPlugin when ResizeObserver is available.
 * ```
 *
 * @example Node.js / server
 * ```ts
 * import { StaticSizeProvider } from '@gwenjs/renderer-core'
 * // gwen.config.ts:
 * screen: { sizeProvider: StaticSizeProvider({ width: 1920, height: 1080 }) }
 * ```
 */

/**
 * Controls how `ScreenPlugin` discovers and tracks the game container size.
 *
 * Implement this interface to support custom environments (Electron, native
 * WebViews, game servers, etc.). Pass your implementation via the `screen.sizeProvider`
 * option in `gwen.config.ts`.
 */
export interface ScreenSizeProvider {
  /**
   * Returns the current container size in CSS pixels.
   * Called once at engine initialisation and whenever the size changes.
   */
  getSize(): { width: number; height: number };

  /**
   * Subscribes to size changes. Called once at `engine:init`.
   *
   * @param callback - Invoked with new dimensions whenever the container resizes.
   * @returns A cleanup function. Called automatically by `ScreenPlugin` on `engine:stop`.
   */
  subscribe(callback: (width: number, height: number) => void): () => void;
}

/**
 * A `ScreenSizeProvider` that never changes — always returns the same dimensions.
 * Use for Node.js game servers or any non-browser environment.
 *
 * @example
 * ```ts
 * // gwen.config.ts
 * screen: { sizeProvider: StaticSizeProvider({ width: 1920, height: 1080 }) }
 * ```
 */
export function StaticSizeProvider(size: { width: number; height: number }): ScreenSizeProvider {
  return {
    getSize() {
      return { width: size.width, height: size.height };
    },
    subscribe(_callback) {
      return () => {};
    },
  };
}

/**
 * A `ScreenSizeProvider` backed by `ResizeObserver` on a DOM element.
 * This is the default provider used by `ScreenPlugin` when `ResizeObserver`
 * is available and no custom `sizeProvider` is configured.
 *
 * @param element - The element to observe. Defaults to `document.documentElement`
 *   (the `<html>` element), which equals the viewport for fullscreen games.
 *   For embedded games, pass the specific container element.
 *
 * @example Fullscreen game (zero config — default behaviour)
 * ```ts
 * // ScreenPlugin uses BrowserSizeProvider() automatically.
 * ```
 *
 * @example Embedded game
 * ```ts
 * const container = document.getElementById('game-container')!
 * screen: { sizeProvider: BrowserSizeProvider(container) }
 * ```
 */
export function BrowserSizeProvider(element?: HTMLElement | null): ScreenSizeProvider {
  const target: HTMLElement | null =
    element !== undefined
      ? element
      : typeof document !== "undefined"
        ? document.documentElement
        : null;

  return {
    getSize() {
      if (!target) return { width: 0, height: 0 };
      return { width: target.clientWidth, height: target.clientHeight };
    },
    subscribe(callback) {
      if (!target || typeof ResizeObserver === "undefined") return () => {};
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          callback(width, height);
        }
      });
      ro.observe(target);
      return () => ro.disconnect();
    },
  };
}
