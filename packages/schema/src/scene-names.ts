/**
 * Scene names discovered from `src/scenes/`.
 *
 * Augmented only by the generated `.gwen/types/scenes.d.ts`.
 * Fix: add a file under `src/scenes/` that exports this scene.
 */
export interface GwenSceneRegistry {}

/**
 * A scene name.
 *
 * `string` while {@link GwenSceneRegistry} has no keys (library and test code).
 * Otherwise the keys of that registry.
 */
export type GwenSceneName = [keyof GwenSceneRegistry] extends [never]
  ? string
  : keyof GwenSceneRegistry & string;
