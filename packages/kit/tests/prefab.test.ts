/**
 * @gwenjs/kit — Prefab factory pattern tests.
 *
 * `definePrefab` is a game-development primitive that lives in `@gwenjs/core`,
 * not in `@gwenjs/kit`. These tests verify the equivalent pattern: using
 * `definePlugin` to author a plugin that provides an entity-factory service
 * (the recommended "prefab" approach for plugins).
 *
 * Tests cover:
 * - A plugin factory creates valid GwenPlugin objects
 * - The plugin registers a factory helper on the engine
 * - The factory produces entities with all expected components
 * - Instantiation-time overrides are merged with defaults
 */

import { describe, it, expect, vi } from 'vitest';
import { definePlugin } from '../src/index';
import type { GwenEngine } from '@gwenjs/core';

// ── Mock engine ───────────────────────────────────────────────────────────────

function mockEngine(): GwenEngine {
  const services = new Map<string, unknown>();
  const components = new Map<string, Record<string, unknown>>();

  return {
    provide: (key: string, value: unknown) => {
      services.set(key, value);
    },
    inject: (key: string) => {
      const v = services.get(key);
      if (v === undefined) throw new Error(`No service: ${key}`);
      return v;
    },
    tryInject: (key: string) => services.get(key),
    use: vi.fn().mockResolvedValue(undefined),
    unuse: vi.fn().mockResolvedValue(undefined),
    hooks: { hook: vi.fn(), callHook: vi.fn() },
    addComponent: vi.fn((id: number, name: string, data: Record<string, unknown>) => {
      components.set(`${id}:${name}`, data);
    }),
    getComponent: vi.fn((id: number, name: string) => components.get(`${id}:${name}`)),
    createEntity: vi.fn(() => 1),
    wasmBridge: {
      physics2d: { enabled: false, enable: vi.fn(), disable: vi.fn(), step: vi.fn() },
      physics3d: { enabled: false, enable: vi.fn(), disable: vi.fn(), step: vi.fn() },
    },
  } as unknown as GwenEngine;
}

// ── Prefab factory pattern using definePlugin ─────────────────────────────────

interface PlayerPrefabOptions {
  /** @default 100 */
  health?: number;
  /** @default 'player' */
  tag?: string;
}

/**
 * Example plugin that registers a "player prefab" factory on the engine.
 * Demonstrates the recommended pattern for entity templates in GWEN plugins.
 */
const PlayerPrefabPlugin = definePlugin((defaults: PlayerPrefabOptions = {}) => ({
  name: 'PlayerPrefabPlugin',

  setup(engine: GwenEngine): void {
    const factory = (overrides: PlayerPrefabOptions = {}) => {
      const merged = { health: 100, tag: 'player', ...defaults, ...overrides };
      const id = (engine as any).createEntity() as number;
      (engine as any).addComponent(id, 'health', { value: merged.health });
      (engine as any).addComponent(id, 'tag', { name: merged.tag });
      return id;
    };

    (engine as any).provide('playerFactory', factory);
  },

  teardown(): void {
    // nothing to clean up
  },
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('definePlugin() — prefab factory pattern', () => {
  it('returns a plugin factory that produces a valid GwenPlugin', () => {
    const plugin = PlayerPrefabPlugin();
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe('PlayerPrefabPlugin');
    expect(typeof plugin.setup).toBe('function');
  });

  it('calls setup() with the engine instance', () => {
    const engine = mockEngine();
    const setupSpy = vi.fn();
    const Plugin = definePlugin(() => ({ name: 'Spy', setup: setupSpy }));
    Plugin().setup(engine);
    expect(setupSpy).toHaveBeenCalledWith(engine);
  });

  it('registers provided services on the engine during setup', () => {
    const engine = mockEngine();
    PlayerPrefabPlugin().setup(engine);
    const factory = (engine as any).tryInject('playerFactory');
    expect(typeof factory).toBe('function');
  });

  it('calls teardown() when the plugin is torn down', () => {
    const teardownSpy = vi.fn();
    const Plugin = definePlugin(() => ({
      name: 'Teardown',
      setup: vi.fn(),
      teardown: teardownSpy,
    }));
    const p = Plugin();
    p.setup(mockEngine());
    p.teardown!();
    expect(teardownSpy).toHaveBeenCalledOnce();
  });
});

describe('definePrefab() — entity factory with defaults and overrides', () => {
  it('instantiates an entity with all defined components', () => {
    const engine = mockEngine();
    PlayerPrefabPlugin().setup(engine);

    const factory = (engine as any).inject('playerFactory') as (o?: PlayerPrefabOptions) => number;
    const id = factory();

    expect((engine as any).getComponent(id, 'health')).toEqual({ value: 100 });
    expect((engine as any).getComponent(id, 'tag')).toEqual({ name: 'player' });
  });

  it('merges instantiation-time overrides with plugin defaults', () => {
    const engine = mockEngine();
    PlayerPrefabPlugin({ health: 200 }).setup(engine);

    const factory = (engine as any).inject('playerFactory') as (o?: PlayerPrefabOptions) => number;
    const id = factory({ health: 50, tag: 'boss' });

    expect((engine as any).getComponent(id, 'health')).toEqual({ value: 50 });
    expect((engine as any).getComponent(id, 'tag')).toEqual({ name: 'boss' });
  });
});
