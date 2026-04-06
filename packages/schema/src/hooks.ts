/**
 * Core GWEN hooks contracts.
 *
 * This file intentionally contains only type-level contracts so it can be the
 * single source of truth shared by engine-core, kit and CLI tooling.
 */

/** Engine lifecycle hooks fired by the runtime loop. */
export interface EngineLifecycleHooks {
  'engine:init': () => void;
  'engine:start': () => void;
  'engine:stop': () => void;
  'engine:tick': (deltaTime: number) => void;
  'engine:runtimeError': (error: RuntimeErrorRecord) => void;
}

/**
 * Structured runtime error payload emitted by the engine when a plugin phase fails.
 * This contract is designed for monitoring/alerting pipelines.
 */
export interface RuntimeErrorRecord {
  phase: 'plugin:beforeUpdate' | 'plugin:update' | 'plugin:render' | 'wasm:onStep';
  plugin: string;
  message: string;
  stack?: string;
  timestamp: number;
  frame: number;
}

/** Plugin lifecycle hooks fired by the plugin manager. */
export interface PluginLifecycleHooks<Plugin = unknown, API = unknown> {
  'plugin:register': (plugin: Plugin) => void;
  'plugin:init': (plugin: Plugin, api: API) => void;
  'plugin:beforeUpdate': (api: API, deltaTime: number) => void;
  'plugin:update': (api: API, deltaTime: number) => void;
  'plugin:render': (api: API) => void;
  'plugin:destroy': (plugin: Plugin) => void;
}

/** Entity lifecycle hooks. */
export interface EntityLifecycleHooks<EntityId = unknown> {
  'entity:create': (id: EntityId) => void;
  'entity:destroy': (id: EntityId) => void;
  'entity:destroyed': (id: EntityId) => void;
}

/** Component lifecycle hooks. */
export interface ComponentLifecycleHooks<EntityId = unknown> {
  'component:add': (id: EntityId, type: string, data: unknown) => void;
  'component:remove': (id: EntityId, type: string) => void;
  'component:removed': (id: EntityId, type: string) => void;
  'component:update': (id: EntityId, type: string, data: unknown) => void;
}

/** Scene lifecycle hooks. */
export interface SceneLifecycleHooks<ReloadContext = unknown> {
  'scene:beforeLoad': (name: string) => void;
  'scene:load': (name: string) => void;
  'scene:loaded': (name: string) => void;
  'scene:beforeUnload': (name: string) => void;
  'scene:unload': (name: string) => void;
  'scene:unloaded': (name: string) => void;
  'scene:willReload': (name: string, context: ReloadContext) => void;
}

/**
 * Extension lifecycle hooks — fired when a prefab, scene or UI is instantiated
 * with an `extensions` map. Plugins subscribe to receive their slice of data.
 *
 * Type parameters mirror the same pattern as `EntityLifecycleHooks<EntityId>`:
 * engine-core binds them to concrete global interface types via `GwenHooks`.
 *
 * @typeParam PrefabExt - Shape of `GwenPrefabExtensions` (bound by engine-core)
 * @typeParam SceneExt  - Shape of `GwenSceneExtensions`  (bound by engine-core)
 * @typeParam UIExt     - Shape of `GwenUIExtensions`     (bound by engine-core)
 * @typeParam EntityId  - Entity identifier type
 */
export interface ExtensionLifecycleHooks<
  PrefabExt = unknown,
  SceneExt = unknown,
  UIExt = unknown,
  EntityId = unknown,
> {
  /**
   * Fired by `PrefabManager.instantiate()` after `create()` returns, when the
   * prefab declares at least one extension key.
   */
  'prefab:instantiate': (entityId: EntityId, extensions: Readonly<Partial<PrefabExt>>) => void;

  /**
   * Fired by `SceneManager` after `onEnter()` is called, when the scene
   * declares at least one extension key.
   */
  'scene:extensions': (sceneName: string, extensions: Readonly<Partial<SceneExt>>) => void;

  /**
   * Fired by `UIManager` when a UIDefinition with extensions is first mounted
   * on an entity.
   */
  'ui:extensions': (
    uiName: string,
    entityId: EntityId,
    extensions: Readonly<Partial<UIExt>>,
  ) => void;
}

/**
 * Global hooks map.
 *
 * Type parameters let engine-core plug concrete runtime types while tooling can
 * keep generic defaults.
 */
export interface GwenHooks<
  EntityId = unknown,
  Plugin = unknown,
  API = unknown,
  ReloadContext = unknown,
  PrefabExt = unknown,
  SceneExt = unknown,
  UIExt = unknown,
>
  extends
    EngineLifecycleHooks,
    PluginLifecycleHooks<Plugin, API>,
    EntityLifecycleHooks<EntityId>,
    ComponentLifecycleHooks<EntityId>,
    SceneLifecycleHooks<ReloadContext>,
    ExtensionLifecycleHooks<PrefabExt, SceneExt, UIExt, EntityId> {}
