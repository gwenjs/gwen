/**
 * @file RFC-004 — GwenApp module system tests
 *
 * Tests the `GwenApp` orchestrator and the `defineGwenModule` helper.
 * All WASM and file-system I/O is avoided — modules are injected via the
 * `moduleLoader` parameter of `setupModules()`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineGwenModule } from '@gwenjs/kit';
import type { GwenModule, AutoImport, GwenTypeTemplate, GwenPlugin } from '@gwenjs/kit';
import { GwenApp } from '../src/app.js';
import { resolveConfig } from '../src/config.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a simple moduleLoader that maps name → GwenModule.
 *
 * @param registry - Map from module name to module definition.
 */
function makeLoader(registry: Record<string, GwenModule>): (name: string) => Promise<GwenModule> {
  return async (name: string) => {
    const mod = registry[name];
    if (!mod) throw new Error(`[test] Unknown module: ${name}`);
    return mod;
  };
}

// ─── defineGwenModule ─────────────────────────────────────────────────────────

describe('defineGwenModule', () => {
  it('returns the definition object unchanged', () => {
    const definition = {
      meta: { name: '@test/my-module' },
      defaults: { speed: 1 },
      setup: vi.fn(),
    };

    const mod = defineGwenModule(definition);

    expect(mod).toBe(definition);
    expect(mod.meta.name).toBe('@test/my-module');
    expect(mod.defaults).toEqual({ speed: 1 });
    expect(typeof mod.setup).toBe('function');
  });

  it('works without defaults', () => {
    const mod = defineGwenModule({
      meta: { name: '@test/no-defaults' },
      setup: vi.fn(),
    });

    expect(mod.meta.name).toBe('@test/no-defaults');
    expect(mod.defaults).toBeUndefined();
  });

  it('preserves async setup signature', async () => {
    const setupFn = vi.fn().mockResolvedValue(undefined);
    const mod = defineGwenModule({
      meta: { name: '@test/async-module' },
      setup: setupFn,
    });

    // Should return a Promise
    const result = mod.setup({}, {} as Parameters<typeof mod.setup>[1]);
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(setupFn).toHaveBeenCalledTimes(1);
  });
});

// ─── GwenApp — options merging ────────────────────────────────────────────────

describe('GwenApp.setupModules — options merging', () => {
  it('calls setup with module defaults when no user options are provided', async () => {
    const setupFn = vi.fn();
    const mod = defineGwenModule({
      meta: { name: '@test/mod' },
      defaults: { gravity: 9.81, iterations: 8 },
      setup: setupFn,
    });

    const config = resolveConfig({
      modules: ['@test/mod'],
    });

    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/mod': mod }));

    expect(setupFn).toHaveBeenCalledOnce();
    const [receivedOptions] = setupFn.mock.calls[0] as [Record<string, unknown>];
    expect(receivedOptions).toMatchObject({ gravity: 9.81, iterations: 8 });
  });

  it('user options override module defaults (shallow)', async () => {
    const setupFn = vi.fn();
    const mod = defineGwenModule({
      meta: { name: '@test/mod' },
      defaults: { gravity: 9.81, iterations: 8 },
      setup: setupFn,
    });

    const config = resolveConfig({
      modules: [['@test/mod', { gravity: 20 }]],
    });

    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/mod': mod }));

    const [receivedOptions] = setupFn.mock.calls[0] as [Record<string, unknown>];
    expect(receivedOptions.gravity).toBe(20);
    // Default still present for non-overridden keys
    expect(receivedOptions.iterations).toBe(8);
  });

  it('user options override module defaults (deep merge)', async () => {
    const setupFn = vi.fn();
    const mod = defineGwenModule({
      meta: { name: '@test/deep' },
      defaults: { renderer: { shadows: true, msaa: 4 } },
      setup: setupFn,
    });

    const config = resolveConfig({
      modules: [['@test/deep', { renderer: { msaa: 2 } }]],
    });

    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/deep': mod }));

    const [receivedOptions] = setupFn.mock.calls[0] as [Record<string, unknown>];
    const renderer = receivedOptions['renderer'] as Record<string, unknown>;
    // Deep-merged: user msaa=2 wins, default shadows=true preserved
    expect(renderer.msaa).toBe(2);
    expect(renderer.shadows).toBe(true);
  });

  it('tuple entry [name, opts] is resolved correctly', async () => {
    const setupFn = vi.fn();
    const mod = defineGwenModule({
      meta: { name: '@test/tuple' },
      defaults: { x: 1 },
      setup: setupFn,
    });

    const config = resolveConfig({
      modules: [['@test/tuple', { x: 99 }]],
    });

    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/tuple': mod }));

    const [receivedOptions] = setupFn.mock.calls[0] as [Record<string, unknown>];
    expect(receivedOptions.x).toBe(99);
  });

  it('empty user options {} preserves all defaults', async () => {
    const setupFn = vi.fn();
    const mod = defineGwenModule({
      meta: { name: '@test/empty-opts' },
      defaults: { a: 1, b: 2 },
      setup: setupFn,
    });

    const config = resolveConfig({
      modules: [['@test/empty-opts', {}]],
    });

    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/empty-opts': mod }));

    const [receivedOptions] = setupFn.mock.calls[0] as [Record<string, unknown>];
    expect(receivedOptions).toMatchObject({ a: 1, b: 2 });
  });
});

// ─── GwenApp — plugin collection ──────────────────────────────────────────────

describe('GwenApp.setupModules — plugin collection', () => {
  it('collects plugins registered via gwen.addPlugin()', async () => {
    const fakePlugin = { name: 'test-plugin' as const };
    const mod = defineGwenModule({
      meta: { name: '@test/plugin-mod' },
      setup(_opts, gwen) {
        gwen.addPlugin(fakePlugin as Parameters<typeof gwen.addPlugin>[0]);
      },
    });

    const config = resolveConfig({ modules: ['@test/plugin-mod'] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/plugin-mod': mod }));

    expect(app.plugins).toHaveLength(1);
    expect(app.plugins[0]).toBe(fakePlugin);
  });

  it('collects plugins from multiple modules in order', async () => {
    const pluginA = { name: 'plugin-a' as const };
    const pluginB = { name: 'plugin-b' as const };

    const modA = defineGwenModule({
      meta: { name: '@test/mod-a' },
      setup(_opts, gwen) {
        gwen.addPlugin(pluginA as Parameters<typeof gwen.addPlugin>[0]);
      },
    });
    const modB = defineGwenModule({
      meta: { name: '@test/mod-b' },
      setup(_opts, gwen) {
        gwen.addPlugin(pluginB as Parameters<typeof gwen.addPlugin>[0]);
      },
    });

    const config = resolveConfig({ modules: ['@test/mod-a', '@test/mod-b'] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/mod-a': modA, '@test/mod-b': modB }));

    expect(app.plugins).toHaveLength(2);
    expect(app.plugins[0]).toBe(pluginA);
    expect(app.plugins[1]).toBe(pluginB);
  });

  it('unwraps factory functions passed to addPlugin()', async () => {
    const fakePlugin = { name: 'factory-plugin' as const };
    const factory = vi.fn(() => fakePlugin);

    const mod = defineGwenModule({
      meta: { name: '@test/factory-mod' },
      setup(_opts, gwen) {
        gwen.addPlugin(factory as unknown as Parameters<typeof gwen.addPlugin>[0]);
      },
    });

    const config = resolveConfig({ modules: ['@test/factory-mod'] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/factory-mod': mod }));

    expect(factory).toHaveBeenCalledOnce();
    expect(app.plugins[0]).toBe(fakePlugin);
  });
});

// ─── GwenApp — auto-imports & type templates ──────────────────────────────────

describe('GwenApp.setupModules — auto-imports and type templates', () => {
  it('accumulates auto-imports from multiple modules', async () => {
    const importA: AutoImport = { name: 'usePhysics', from: '@test/physics' };
    const importB: AutoImport = { name: 'useInput', from: '@test/input' };

    const modA = defineGwenModule({
      meta: { name: '@test/physics' },
      setup(_opts, gwen) {
        gwen.addAutoImports([importA]);
      },
    });
    const modB = defineGwenModule({
      meta: { name: '@test/input' },
      setup(_opts, gwen) {
        gwen.addAutoImports([importB]);
      },
    });

    const config = resolveConfig({ modules: ['@test/physics', '@test/input'] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/physics': modA, '@test/input': modB }));

    expect(app.autoImports).toHaveLength(2);
    expect(app.autoImports).toContainEqual(importA);
    expect(app.autoImports).toContainEqual(importB);
  });

  it('accumulates type templates from modules', async () => {
    const template: GwenTypeTemplate = {
      filename: 'types/test.d.ts',
      getContents: () => `declare module '@test/mod' {}`,
    };

    const mod = defineGwenModule({
      meta: { name: '@test/type-mod' },
      setup(_opts, gwen) {
        gwen.addTypeTemplate(template);
      },
    });

    const config = resolveConfig({ modules: ['@test/type-mod'] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/type-mod': mod }));

    expect(app.typeTemplates).toHaveLength(1);
    expect(app.typeTemplates[0]).toBe(template);
  });

  it('gwen.options exposes the resolved config', async () => {
    let capturedOptions: unknown;

    const mod = defineGwenModule({
      meta: { name: '@test/opts-mod' },
      setup(_opts, gwen) {
        capturedOptions = gwen.options;
      },
    });

    const config = resolveConfig({
      modules: ['@test/opts-mod'],
      engine: { maxEntities: 999 },
    });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/opts-mod': mod }));

    expect((capturedOptions as typeof config).engine.maxEntities).toBe(999);
  });
});

// ─── GwenApp — Vite config extension ─────────────────────────────────────────

describe('GwenApp.resolveViteConfig', () => {
  it('returns the base config unmodified when no extenders are registered', async () => {
    const config = resolveConfig({ modules: [] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({}));

    const base = { root: './src', plugins: [] };
    const result = app.resolveViteConfig(base);

    expect(result).toMatchObject({ root: './src', plugins: [] });
  });

  it('applies a single extender from a module', async () => {
    const mod = defineGwenModule({
      meta: { name: '@test/vite-mod' },
      setup(_opts, gwen) {
        gwen.extendViteConfig(() => ({ define: { __VERSION__: '"1.0.0"' } }));
      },
    });

    const config = resolveConfig({ modules: ['@test/vite-mod'] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/vite-mod': mod }));

    const result = app.resolveViteConfig({ root: './src' });
    expect(result.define).toEqual({ __VERSION__: '"1.0.0"' });
    expect(result.root).toBe('./src');
  });

  it('applies extenders from multiple modules in registration order', async () => {
    const order: string[] = [];

    const modA = defineGwenModule({
      meta: { name: '@test/ext-a' },
      setup(_opts, gwen) {
        gwen.extendViteConfig(() => {
          order.push('a');
          return { customA: true };
        });
      },
    });
    const modB = defineGwenModule({
      meta: { name: '@test/ext-b' },
      setup(_opts, gwen) {
        gwen.extendViteConfig(() => {
          order.push('b');
          return { customB: true };
        });
      },
    });

    const config = resolveConfig({ modules: ['@test/ext-a', '@test/ext-b'] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/ext-a': modA, '@test/ext-b': modB }));

    const result = app.resolveViteConfig({});

    expect(order).toEqual(['a', 'b']);
    expect(result.customA).toBe(true);
    expect(result.customB).toBe(true);
  });

  it('applies root-level config.vite as the last extender', async () => {
    const mod = defineGwenModule({
      meta: { name: '@test/vite-first' },
      setup(_opts, gwen) {
        gwen.extendViteConfig(() => ({ base: '/from-module/' }));
      },
    });

    // root-level vite key should override the module's extension
    const config = resolveConfig({
      modules: ['@test/vite-first'],
      vite: { base: '/from-root/' },
    });

    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/vite-first': mod }));

    const result = app.resolveViteConfig({});
    // Root vite applied last — wins over module extension
    expect(result.base).toBe('/from-root/');
  });

  it('each extender receives the accumulated config from previous extenders', async () => {
    const mod = defineGwenModule({
      meta: { name: '@test/chain' },
      setup(_opts, gwen) {
        gwen.extendViteConfig(() => ({ counter: 1 }));
        gwen.extendViteConfig((cfg) => ({ counter: (cfg['counter'] as number) + 1 }));
      },
    });

    const config = resolveConfig({ modules: ['@test/chain'] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/chain': mod }));

    const result = app.resolveViteConfig({});
    expect(result.counter).toBe(2);
  });
});

// ─── GwenApp — build hooks ────────────────────────────────────────────────────

describe('GwenApp — build hooks', () => {
  let hookOrder: string[];

  beforeEach(() => {
    hookOrder = [];
  });

  it('fires hooks in correct order: build:before → module:before → module:done → build:done', async () => {
    const mod = defineGwenModule({
      meta: { name: '@test/hook-mod' },
      setup: vi.fn(),
    });

    const config = resolveConfig({ modules: ['@test/hook-mod'] });
    const app = new GwenApp();

    app.buildHooks.hook('build:before', () => {
      hookOrder.push('build:before');
    });
    app.buildHooks.hook('module:before', () => {
      hookOrder.push('module:before');
    });
    app.buildHooks.hook('module:done', () => {
      hookOrder.push('module:done');
    });
    app.buildHooks.hook('build:done', () => {
      hookOrder.push('build:done');
    });

    await app.setupModules(config, makeLoader({ '@test/hook-mod': mod }));

    expect(hookOrder).toEqual(['build:before', 'module:before', 'module:done', 'build:done']);
  });

  it('module:before and module:done receive the module as argument', async () => {
    const mod = defineGwenModule({
      meta: { name: '@test/arg-mod' },
      setup: vi.fn(),
    });

    const config = resolveConfig({ modules: ['@test/arg-mod'] });
    const app = new GwenApp();

    const beforeArg = vi.fn();
    const doneArg = vi.fn();
    app.buildHooks.hook('module:before', beforeArg);
    app.buildHooks.hook('module:done', doneArg);

    await app.setupModules(config, makeLoader({ '@test/arg-mod': mod }));

    expect(beforeArg).toHaveBeenCalledWith(mod);
    expect(doneArg).toHaveBeenCalledWith(mod);
  });

  it('fires module hooks once per module when multiple modules are listed', async () => {
    const modA = defineGwenModule({ meta: { name: '@test/a' }, setup: vi.fn() });
    const modB = defineGwenModule({ meta: { name: '@test/b' }, setup: vi.fn() });

    const config = resolveConfig({ modules: ['@test/a', '@test/b'] });
    const app = new GwenApp();

    const beforeFn = vi.fn();
    const doneFn = vi.fn();
    app.buildHooks.hook('module:before', beforeFn);
    app.buildHooks.hook('module:done', doneFn);

    await app.setupModules(config, makeLoader({ '@test/a': modA, '@test/b': modB }));

    expect(beforeFn).toHaveBeenCalledTimes(2);
    expect(doneFn).toHaveBeenCalledTimes(2);
  });

  it('build:before fires before any module setup', async () => {
    const setupOrder: string[] = [];

    const mod = defineGwenModule({
      meta: { name: '@test/order-mod' },
      setup() {
        setupOrder.push('setup');
      },
    });

    const config = resolveConfig({ modules: ['@test/order-mod'] });
    const app = new GwenApp();
    app.buildHooks.hook('build:before', () => {
      setupOrder.push('build:before');
    });

    await app.setupModules(config, makeLoader({ '@test/order-mod': mod }));

    expect(setupOrder[0]).toBe('build:before');
    expect(setupOrder[1]).toBe('setup');
  });

  it('build:done fires after all module setup is complete', async () => {
    const setupOrder: string[] = [];

    const modA = defineGwenModule({
      meta: { name: '@test/done-a' },
      setup() {
        setupOrder.push('a');
      },
    });
    const modB = defineGwenModule({
      meta: { name: '@test/done-b' },
      setup() {
        setupOrder.push('b');
      },
    });

    const config = resolveConfig({ modules: ['@test/done-a', '@test/done-b'] });
    const app = new GwenApp();
    app.buildHooks.hook('build:done', () => {
      setupOrder.push('build:done');
    });

    await app.setupModules(config, makeLoader({ '@test/done-a': modA, '@test/done-b': modB }));

    expect(setupOrder).toEqual(['a', 'b', 'build:done']);
  });

  it('a module can subscribe to hooks via gwen.hook()', async () => {
    const hookFired = vi.fn();

    const mod = defineGwenModule({
      meta: { name: '@test/inner-hook-mod' },
      setup(_opts, gwen) {
        gwen.hook('build:done', hookFired);
      },
    });

    const config = resolveConfig({ modules: ['@test/inner-hook-mod'] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/inner-hook-mod': mod }));

    expect(hookFired).toHaveBeenCalledOnce();
  });
});

// ─── GwenApp — Vite plugins collection ───────────────────────────────────────

describe('GwenApp.setupModules — Vite plugin collection', () => {
  it('collects Vite plugins registered via gwen.addVitePlugin()', async () => {
    const vitePlugin = { name: 'my-vite-plugin', transform: vi.fn() };

    const mod = defineGwenModule({
      meta: { name: '@test/vite-plugin-mod' },
      setup(_opts, gwen) {
        gwen.addVitePlugin(vitePlugin);
      },
    });

    const config = resolveConfig({ modules: ['@test/vite-plugin-mod'] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/vite-plugin-mod': mod }));

    expect(app.vitePlugins).toHaveLength(1);
    expect(app.vitePlugins[0]).toBe(vitePlugin);
  });
});

// ─── GwenApp — getter immutability ───────────────────────────────────────────

describe('GwenApp — getter immutability', () => {
  it('plugins getter returns a defensive copy', async () => {
    const plugin = { name: 'immutable-test' as const };

    const mod = defineGwenModule({
      meta: { name: '@test/immut' },
      setup(_opts, gwen) {
        gwen.addPlugin(plugin as Parameters<typeof gwen.addPlugin>[0]);
      },
    });

    const config = resolveConfig({ modules: ['@test/immut'] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ '@test/immut': mod }));

    const snap1 = app.plugins;
    snap1.push({ name: 'injected' as const } as unknown as GwenPlugin);

    // The internal array should NOT have been mutated
    expect(app.plugins).toHaveLength(1);
  });
});

// ─── resolveConfig ────────────────────────────────────────────────────────────

describe('resolveConfig', () => {
  it('fills in engine defaults when none are provided', () => {
    const cfg = resolveConfig({});

    expect(cfg.engine.maxEntities).toBe(10_000);
    expect(cfg.engine.targetFPS).toBe(60);
    expect(cfg.engine.variant).toBe('light');
    expect(cfg.engine.loop).toBe('internal');
    expect(cfg.engine.maxDeltaSeconds).toBe(0.1);
  });

  it('user engine values override defaults', () => {
    const cfg = resolveConfig({ engine: { maxEntities: 500 } });

    expect(cfg.engine.maxEntities).toBe(500);
    expect(cfg.engine.targetFPS).toBe(60); // default preserved
  });

  it('modules defaults to an empty array', () => {
    const cfg = resolveConfig({});
    expect(cfg.modules).toEqual([]);
  });

  it('preserves user-provided modules array', () => {
    const cfg = resolveConfig({ modules: ['@test/mod-a', ['@test/mod-b', { x: 1 }]] });
    expect(cfg.modules).toHaveLength(2);
  });
});
