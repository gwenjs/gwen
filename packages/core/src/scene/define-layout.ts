/**
 * @file `defineLayout()` — declarative scene composition factory.
 *
 * `defineLayout` registers a factory function that will be executed once per
 * `useLayout().load()` call. The factory runs inside an active layout context
 * (`_withLayoutContext`) and inside the active engine context, so all placement
 * composables (`placeActor`, `placeGroup`, `placePrefab`) and engine composables
 * work as expected.
 *
 * The factory is **not** called until `load()` is explicitly invoked. This enables
 * lazy loading strategies in `useLayout`.
 *
 * @example
 * ```typescript
 * export const GameLayout = defineLayout(() => {
 *   const player = placeActor(PlayerActor, { at: [0, 0], props: { hp: 100 } })
 *   const ground = placeGroup({ at: [0, 200] })
 *   return { player, ground }
 * })
 * ```
 */

import type { LayoutDefinition, PlaceHandle } from './types.js';

/**
 * Define a layout — a declarative factory describing the initial composition of a scene.
 *
 * The `factory` is called once per `useLayout().load()`. Inside the factory,
 * `placeActor`, `placeGroup`, and `placePrefab` are available to spawn entities.
 * The object returned by `factory` becomes `LayoutHandle.refs`.
 *
 * @param factory - Synchronous function using placement composables and returning named handles.
 * @returns A `LayoutDefinition` to pass to `useLayout()`.
 *
 * @example
 * ```typescript
 * export const Level1Layout = defineLayout(() => {
 *   const player = placeActor(PlayerActor, { at: [48, 160] })
 *   return { player }
 * })
 * ```
 */
export function defineLayout<Refs extends Record<string, PlaceHandle<unknown>>>(
  factory: () => Refs,
): LayoutDefinition<Refs> {
  return {
    _factory: factory,
    __layoutName__: 'anonymous',
  };
}
