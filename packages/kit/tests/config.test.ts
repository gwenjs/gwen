import { describe, expect, it } from 'vitest';
import {
  type GwenPlugin,
  type MergePluginsPrefabExtensions,
  type MergePluginsSceneExtensions,
  type MergePluginsUIExtensions,
} from '../src';
import { defineConfig } from '@gwenjs/app';

// V2 GwenPlugin instances (setup/teardown, no generics)
const PluginA: GwenPlugin = { name: 'A', setup(_engine) {} };
const PluginB: GwenPlugin = { name: 'B', setup(_engine) {} };

// Plugins with extension schemas (structural extension pattern)
const PhysicsPlugin = {
  name: 'physics' as const,
  setup(_engine: import('@gwenjs/core').GwenEngine) {},
  extensions: {
    prefab: {} as { mass: number; isStatic: boolean },
    scene: {} as { gravity: number },
  },
} satisfies GwenPlugin & {
  extensions: { prefab: { mass: number; isStatic: boolean }; scene: { gravity: number } };
};

const AudioPlugin = {
  name: 'audio' as const,
  setup(_engine: import('@gwenjs/core').GwenEngine) {},
  extensions: {
    prefab: {} as { volume: number },
    ui: {} as { layer: string },
  },
} satisfies GwenPlugin & { extensions: { prefab: { volume: number }; ui: { layer: string } } };

describe('@gwenjs/app defineConfig', () => {
  it('keeps runtime payload unchanged', () => {
    const conf = defineConfig({
      engine: { maxEntities: 10_000 },
      plugins: [PluginA, PluginB],
      html: { title: 'Game', background: '#000000' },
    });

    expect(conf.engine?.maxEntities).toBe(10_000);
    expect((conf.plugins ?? []).length).toBe(2);
  });

  it('returns the same config object', () => {
    const input = { engine: { maxEntities: 5_000 } };
    const conf = defineConfig(input);
    expect(conf).toEqual(input);
  });
});

describe('@gwenjs/kit MergePlugins*Extensions', () => {
  it('MergePluginsPrefabExtensions merges prefab extensions from all plugins', () => {
    type Merged = MergePluginsPrefabExtensions<[typeof PhysicsPlugin, typeof AudioPlugin]>;
    const ext: Merged = { mass: 10, isStatic: false, volume: 0.8 };
    expect(ext.mass).toBe(10);
    expect(ext.volume).toBe(0.8);
  });

  it('MergePluginsSceneExtensions merges scene extensions from all plugins', () => {
    type Merged = MergePluginsSceneExtensions<[typeof PhysicsPlugin, typeof AudioPlugin]>;
    const ext: Merged = { gravity: -9.81 };
    expect(ext.gravity).toBe(-9.81);
  });

  it('MergePluginsUIExtensions merges UI extensions from all plugins', () => {
    type Merged = MergePluginsUIExtensions<[typeof PhysicsPlugin, typeof AudioPlugin]>;
    const ext: Merged = { layer: 'hud' };
    expect(ext.layer).toBe('hud');
  });

  it('plugin without extensions contributes empty (no pollution)', () => {
    type Merged = MergePluginsPrefabExtensions<[typeof PluginA]>;
    // Must compile — PluginA has no extensions
    const _ext: Merged = {} as Merged;
    expect(_ext).toBeDefined();
  });
});
