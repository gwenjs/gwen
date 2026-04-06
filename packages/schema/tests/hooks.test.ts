/**
 * GWEN Schema Hooks Tests
 *
 * Tests for centralized hook contracts and their usage.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  EngineLifecycleHooks,
  PluginLifecycleHooks,
  EntityLifecycleHooks,
  ComponentLifecycleHooks,
  SceneLifecycleHooks,
  ExtensionLifecycleHooks,
  GwenHooks,
} from '../src';

describe('@gwenjs/schema - Hooks Contracts', () => {
  describe('EngineLifecycleHooks', () => {
    it('should define all engine lifecycle hooks', () => {
      const hooks: EngineLifecycleHooks = {
        'engine:init': () => {},
        'engine:start': () => {},
        'engine:stop': () => {},
        'engine:tick': (dt) => {
          expectTypeOf(dt).toBeNumber();
        },
        'engine:runtimeError': () => {},
      };
      expect(hooks).toBeDefined();
    });
  });

  describe('PluginLifecycleHooks', () => {
    it('should define all plugin lifecycle hooks', () => {
      const hooks: PluginLifecycleHooks = {
        'plugin:register': () => {},
        'plugin:init': () => {},
        'plugin:beforeUpdate': () => {},
        'plugin:update': () => {},
        'plugin:render': () => {},
        'plugin:destroy': () => {},
      };
      expect(hooks).toBeDefined();
    });
  });

  describe('EntityLifecycleHooks', () => {
    it('should define all entity lifecycle hooks', () => {
      const hooks: EntityLifecycleHooks = {
        'entity:create': () => {},
        'entity:destroy': () => {},
        'entity:destroyed': () => {},
      };
      expect(hooks).toBeDefined();
    });
  });

  describe('ComponentLifecycleHooks', () => {
    it('should define all component lifecycle hooks', () => {
      const hooks: ComponentLifecycleHooks = {
        'component:add': () => {},
        'component:remove': () => {},
        'component:removed': () => {},
        'component:update': () => {},
      };
      expect(hooks).toBeDefined();
    });
  });

  describe('SceneLifecycleHooks', () => {
    it('should define all scene lifecycle hooks', () => {
      const hooks: SceneLifecycleHooks = {
        'scene:beforeLoad': () => {},
        'scene:load': () => {},
        'scene:loaded': () => {},
        'scene:beforeUnload': () => {},
        'scene:unload': () => {},
        'scene:unloaded': () => {},
        'scene:willReload': () => {},
      };
      expect(hooks).toBeDefined();
    });
  });

  describe('ExtensionLifecycleHooks', () => {
    it('should define all extension lifecycle hooks with generic defaults', () => {
      const hooks: ExtensionLifecycleHooks = {
        'prefab:instantiate': () => {},
        'scene:extensions': () => {},
        'ui:extensions': () => {},
      };
      expect(hooks).toBeDefined();
    });

    it('should type extensions argument from generic parameters', () => {
      type PrefabExt = { mass: number; isStatic: boolean };
      type SceneExt = { gravity: number };
      type UIExt = { layer: string };
      type BoundHooks = ExtensionLifecycleHooks<PrefabExt, SceneExt, UIExt, number>;

      const hooks: Partial<BoundHooks> = {
        'prefab:instantiate': (entityId: number, extensions) => {
          expectTypeOf(entityId).toBeNumber();
          expectTypeOf(extensions).toMatchTypeOf<Readonly<Partial<PrefabExt>>>();
        },
        'scene:extensions': (_sceneName: string, extensions) => {
          expectTypeOf(extensions).toMatchTypeOf<Readonly<Partial<SceneExt>>>();
        },
        'ui:extensions': (_uiName: string, entityId: number, extensions) => {
          expectTypeOf(entityId).toBeNumber();
          expectTypeOf(extensions).toMatchTypeOf<Readonly<Partial<UIExt>>>();
        },
      };
      expect(hooks).toBeDefined();
    });
  });

  describe('GwenHooks', () => {
    it('should aggregate all hook categories', () => {
      const hooks: GwenHooks = {
        // Engine
        'engine:init': () => {},
        'engine:start': () => {},
        'engine:stop': () => {},
        'engine:tick': () => {},
        'engine:runtimeError': () => {},
        // Plugin
        'plugin:register': () => {},
        'plugin:init': () => {},
        'plugin:beforeUpdate': () => {},
        'plugin:update': () => {},
        'plugin:render': () => {},
        'plugin:destroy': () => {},
        // Entity
        'entity:create': () => {},
        'entity:destroy': () => {},
        'entity:destroyed': () => {},
        // Component
        'component:add': () => {},
        'component:remove': () => {},
        'component:removed': () => {},
        'component:update': () => {},
        // Scene
        'scene:beforeLoad': () => {},
        'scene:load': () => {},
        'scene:loaded': () => {},
        'scene:beforeUnload': () => {},
        'scene:unload': () => {},
        'scene:unloaded': () => {},
        'scene:willReload': () => {},
        // Extensions
        'prefab:instantiate': () => {},
        'scene:extensions': () => {},
        'ui:extensions': () => {},
      };
      expect(hooks).toBeDefined();
    });

    it('supports generic type parameters for runtime binding', () => {
      type RuntimeHooks = GwenHooks<number, object, object, object>;
      const hooks: Partial<RuntimeHooks> = {
        'engine:tick': () => {},
        'entity:create': (id: number) => {
          expectTypeOf(id).toBeNumber();
        },
        'plugin:init': () => {},
        'component:add': () => {},
        'scene:load': () => {},
      };
      expect(hooks).toBeDefined();
    });
  });
});
