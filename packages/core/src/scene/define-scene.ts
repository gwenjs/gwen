/**
 * Scene primitives — `defineScene()` for declaring game scenes.
 *
 * Scenes are discovered automatically by the GWEN Vite plugin, which scans
 * `src/scenes/` for `defineScene()` calls and generates a registration module.
 *
 * @example
 * ```typescript
 * // src/scenes/game.ts
 * import { defineScene } from '@gwenjs/core'
 * import { PlayerSystem, EnemySystem } from '../systems'
 *
 * export const GameScene = defineScene('Game', () => ({
 *   systems: [PlayerSystem, EnemySystem],
 * }))
 * ```
 */

import type { GwenPlugin } from '../engine/gwen-engine';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal scene registry interface passed to scene factories. */
export interface SceneRegistry {
  /** Register a scene definition with the engine. */
  register(scene: SceneDefinition): void;
}

/** A resolved scene definition ready to be registered with the engine. */
export interface SceneDefinition {
  /** Unique scene name used by the engine router. */
  readonly name: string;
  /** Systems that run each frame while this scene is active. */
  readonly systems: GwenPlugin[];
  /** Optional callback fired when the engine routes to this scene. Receives the params passed to `send()`. */
  readonly onEnter?: (params?: Record<string, unknown>) => void | Promise<void>;
  /** Optional callback fired when the engine routes away from this scene. */
  readonly onExit?: () => void | Promise<void>;
}

/**
 * Options for the object-form of `defineScene`.
 *
 * @example
 * ```typescript
 * export const GameScene = defineScene({ name: 'Game', systems: [PlayerSystem] })
 * ```
 */
export interface SceneOptions {
  /** Unique scene name. */
  name: string;
  /** Systems that run each frame while this scene is active. */
  systems?: GwenPlugin[];
  /** Optional callback fired when the engine routes to this scene. Receives the params passed to `send()`. */
  onEnter?: (params?: Record<string, unknown>) => void | Promise<void>;
  /** Optional callback fired when the engine routes away from this scene. */
  onExit?: () => void | Promise<void>;
}

/**
 * A factory function returned by `defineScene(name, factory)`.
 * Called by the engine bootstrap with the active scene registry so
 * systems can resolve services via dependency injection.
 */
export interface SceneFactory {
  /** Call to produce the resolved `SceneDefinition`. */
  (registry: SceneRegistry): SceneDefinition;
  /**
   * Scene name — exposed as a property so tooling (Vite plugin, CLI)
   * can identify scenes without executing the factory.
   */
  readonly sceneName: string;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Define a game scene (factory form).
 *
 * The factory receives the active `SceneRegistry` and returns a
 * `SceneDefinition`. The returned function is called automatically by the
 * GWEN bootstrap; game code should never call it directly.
 *
 * Scenes are auto-discovered by the GWEN Vite plugin: any file in
 * `src/scenes/` that exports a `defineScene()` call is registered
 * without any manual configuration.
 *
 * @param name    Unique scene name (used by the engine router).
 * @param factory Called once at bootstrap with the scene registry.
 *
 * @example
 * ```typescript
 * export const GameScene = defineScene('Game', () => ({
 *   systems: [PlayerSystem, EnemySystem],
 * }))
 * ```
 */
export function defineScene(
  name: string,
  factory: (registry: SceneRegistry) => {
    systems?: GwenPlugin[];
    onEnter?: () => void | Promise<void>;
    onExit?: () => void | Promise<void>;
  },
): SceneFactory;

/**
 * Define a game scene (options form).
 *
 * Returns a `SceneDefinition` directly — use this form when systems are
 * known statically and do not need to be resolved from the registry.
 *
 * @param options Scene name and system list.
 *
 * @example
 * ```typescript
 * export const GameScene = defineScene({ name: 'Game', systems: [PlayerSystem] })
 * ```
 */
export function defineScene(options: SceneOptions): SceneDefinition;

export function defineScene(
  nameOrOptions: string | SceneOptions,
  factory?: (registry: SceneRegistry) => {
    systems?: GwenPlugin[];
    onEnter?: () => void | Promise<void>;
    onExit?: () => void | Promise<void>;
  },
): SceneFactory | SceneDefinition {
  if (typeof nameOrOptions === 'string') {
    // Factory form: defineScene('Name', factory)
    const name = nameOrOptions;
    const fn = (registry: SceneRegistry): SceneDefinition => {
      const result = factory!(registry);
      return {
        name,
        systems: result.systems ?? [],
        onEnter: result.onEnter,
        onExit: result.onExit,
      };
    };
    Object.defineProperty(fn, 'sceneName', { value: name, writable: false });
    return fn as SceneFactory;
  }

  // Options form: defineScene({ name, systems, ...hooks })
  return {
    name: nameOrOptions.name,
    systems: nameOrOptions.systems ?? [],
    onEnter: nameOrOptions.onEnter,
    onExit: nameOrOptions.onExit,
  };
}
