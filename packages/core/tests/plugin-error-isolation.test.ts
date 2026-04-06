/**
 * Tests for plugin error isolation (RFC-011 Phase 2)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEngine } from '../src/index';
import type { GwenEngine, GwenPlugin, EngineErrorBus } from '../src/index';
import { CoreErrorCodes } from '../src/index';

// ─── Minimal mock error bus ───────────────────────────────────────────────────

function createMockErrorBus(): EngineErrorBus & {
  emitted: Array<Parameters<EngineErrorBus['emit']>[0]>;
} {
  const emitted: Array<Parameters<EngineErrorBus['emit']>[0]> = [];
  return {
    emitted,
    emit(event) {
      emitted.push(event);
    },
    onFatal() {},
  };
}

describe('plugin error isolation', () => {
  describe('_reportPluginError / onError hook', () => {
    it('calls plugin.onError when a lifecycle hook throws', async () => {
      const onError = vi.fn();
      const plugin: GwenPlugin = {
        name: 'test-plugin',
        setup() {},
        onBeforeUpdate() {
          throw new Error('update boom');
        },
        onError,
      };
      const engine = await createEngine();
      await engine.use(plugin);
      await engine.advance(16);

      expect(onError).toHaveBeenCalledOnce();
      const [err, ctx] = onError.mock.calls[0]!;
      expect((err as Error).message).toBe('update boom');
      expect(ctx.phase).toBe('onBeforeUpdate');
    });

    it('does not emit to error bus when plugin calls recover()', async () => {
      const bus = createMockErrorBus();
      const plugin: GwenPlugin = {
        name: 'recovering-plugin',
        setup() {},
        onUpdate() {
          throw new Error('recoverable');
        },
        onError(_err, ctx) {
          ctx.recover();
        },
      };
      const engine = await createEngine({ errorBus: bus });
      await engine.use(plugin);
      await engine.advance(16);

      const runtimeErrors = bus.emitted.filter(
        (e) => e.code === CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
      );
      expect(runtimeErrors).toHaveLength(0);
    });

    it('emits PLUGIN_RUNTIME_ERROR to error bus when recover() is not called', async () => {
      const bus = createMockErrorBus();
      const plugin: GwenPlugin = {
        name: 'crashing-plugin',
        setup() {},
        onUpdate() {
          throw new Error('non-recoverable');
        },
      };
      const engine = await createEngine({ errorBus: bus });
      await engine.use(plugin);
      await engine.advance(16);

      const runtimeErrors = bus.emitted.filter(
        (e) => e.code === CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
      );
      expect(runtimeErrors).toHaveLength(1);
      expect(runtimeErrors[0]!.source).toBe('crashing-plugin');
      expect(runtimeErrors[0]!.message).toContain('non-recoverable');
    });

    it('includes phase and frame in the error context', async () => {
      let capturedPhase: string | undefined;
      let capturedFrame: number | undefined;
      const plugin: GwenPlugin = {
        name: 'phase-check-plugin',
        setup() {},
        onRender() {
          throw new Error('render crash');
        },
        onError(_err, ctx) {
          capturedPhase = ctx.phase;
          capturedFrame = ctx.frame;
          ctx.recover();
        },
      };
      const engine = await createEngine();
      await engine.use(plugin);
      await engine.advance(16);

      expect(capturedPhase).toBe('onRender');
      expect(typeof capturedFrame).toBe('number');
    });

    it('continues the frame even if a plugin throws in onBeforeUpdate', async () => {
      const secondPluginCalled = vi.fn();
      const crasher: GwenPlugin = {
        name: 'crasher',
        setup() {},
        onBeforeUpdate() {
          throw new Error('crash in onBeforeUpdate');
        },
      };
      const survivor: GwenPlugin = {
        name: 'survivor',
        setup() {},
        onBeforeUpdate() {
          secondPluginCalled();
        },
      };
      const engine = await createEngine();
      await engine.use(crasher);
      await engine.use(survivor);
      await engine.advance(16);

      expect(secondPluginCalled).toHaveBeenCalledOnce();
    });

    it('continues the frame even if a plugin throws in onUpdate', async () => {
      const secondPluginCalled = vi.fn();
      const crasher: GwenPlugin = {
        name: 'crasher-update',
        setup() {},
        onUpdate() {
          throw new Error('crash in onUpdate');
        },
      };
      const survivor: GwenPlugin = {
        name: 'survivor-update',
        setup() {},
        onUpdate() {
          secondPluginCalled();
        },
      };
      const engine = await createEngine();
      await engine.use(crasher);
      await engine.use(survivor);
      await engine.advance(16);

      expect(secondPluginCalled).toHaveBeenCalledOnce();
    });

    it('continues the frame even if a plugin throws in onRender', async () => {
      const secondPluginCalled = vi.fn();
      const crasher: GwenPlugin = {
        name: 'crasher-render',
        setup() {},
        onRender() {
          throw new Error('crash in onRender');
        },
      };
      const survivor: GwenPlugin = {
        name: 'survivor-render',
        setup() {},
        onRender() {
          secondPluginCalled();
        },
      };
      const engine = await createEngine();
      await engine.use(crasher);
      await engine.use(survivor);
      await engine.advance(16);

      expect(secondPluginCalled).toHaveBeenCalledOnce();
    });

    it('does not crash if onError itself throws', async () => {
      const bus = createMockErrorBus();
      const plugin: GwenPlugin = {
        name: 'onError-throws-plugin',
        setup() {},
        onUpdate() {
          throw new Error('original error');
        },
        onError() {
          throw new Error('onError itself threw');
        },
      };
      const engine = await createEngine({ errorBus: bus });
      await engine.use(plugin);

      // Should not throw
      await expect(engine.advance(16)).resolves.toBeUndefined();

      // The PLUGIN_RUNTIME_ERROR should still be emitted (since recover was not called before onError threw)
      const runtimeErrors = bus.emitted.filter(
        (e) => e.code === CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
      );
      expect(runtimeErrors).toHaveLength(1);
    });
  });

  describe('plugin setup error', () => {
    it('emits PLUGIN_SETUP_ERROR to error bus when setup throws', async () => {
      const bus = createMockErrorBus();
      const plugin: GwenPlugin = {
        name: 'bad-setup-plugin',
        setup() {
          throw new Error('setup exploded');
        },
      };
      const engine = await createEngine({ errorBus: bus });

      await expect(engine.use(plugin)).rejects.toThrow('setup exploded');

      const setupErrors = bus.emitted.filter((e) => e.code === CoreErrorCodes.PLUGIN_SETUP_ERROR);
      expect(setupErrors).toHaveLength(1);
    });

    it('re-throws after emitting — setup failure is still fatal', async () => {
      const bus = createMockErrorBus();
      const plugin: GwenPlugin = {
        name: 'fatal-setup-plugin',
        setup() {
          throw new Error('fatal setup');
        },
      };
      const engine = await createEngine({ errorBus: bus });

      await expect(engine.use(plugin)).rejects.toThrow('fatal setup');
    });

    it('includes plugin name in the error message', async () => {
      const bus = createMockErrorBus();
      const plugin: GwenPlugin = {
        name: 'named-setup-plugin',
        setup() {
          throw new Error('specific failure');
        },
      };
      const engine = await createEngine({ errorBus: bus });

      await expect(engine.use(plugin)).rejects.toBeDefined();

      const setupErrors = bus.emitted.filter((e) => e.code === CoreErrorCodes.PLUGIN_SETUP_ERROR);
      expect(setupErrors[0]!.message).toContain('named-setup-plugin');
      expect(setupErrors[0]!.message).toContain('specific failure');
    });
  });

  describe('WASM error codes', () => {
    it('emits WASM_PANIC when physics step throws WebAssembly.RuntimeError', async () => {
      const bus = createMockErrorBus();
      const engine = await createEngine({ errorBus: bus });

      // Enable physics2d and override the step to throw a WASM RuntimeError
      engine.wasmBridge.physics2d.enable({});
      engine.wasmBridge.physics2d.step = () => {
        throw new WebAssembly.RuntimeError('unreachable executed');
      };

      await engine.advance(16);

      const wasmPanics = bus.emitted.filter((e) => e.code === CoreErrorCodes.WASM_PANIC);
      expect(wasmPanics).toHaveLength(1);
      expect(wasmPanics[0]!.source).toBe('gwen_core.wasm');
    });

    it('emits FRAME_LOOP_ERROR when physics step throws a non-WASM error', async () => {
      const bus = createMockErrorBus();
      const engine = await createEngine({ errorBus: bus });

      engine.wasmBridge.physics2d.enable({});
      engine.wasmBridge.physics2d.step = () => {
        throw new TypeError('not a wasm error');
      };

      await engine.advance(16);

      const frameErrors = bus.emitted.filter((e) => e.code === CoreErrorCodes.FRAME_LOOP_ERROR);
      expect(frameErrors).toHaveLength(1);
    });

    it('emits with source "wasm:<name>" for community WASM module errors', async () => {
      const bus = createMockErrorBus();
      const engine = await createEngine({ errorBus: bus });

      // Inject a fake entry into the private _wasmModules map to avoid needing a real .wasm file
      const fakeHandle = {
        name: 'my-audio-mod',
        exports: {},
        memory: undefined,
        region: () => {
          throw new Error('no regions');
        },
        channel: () => {
          throw new Error('no channels');
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (engine as any)._wasmModules.set('my-audio-mod', {
        handle: fakeHandle,
        step: () => {
          throw new TypeError('audio step failed');
        },
      });

      await engine.advance(16);

      const wasmErrors = bus.emitted.filter((e) => e.source === 'wasm:my-audio-mod');
      expect(wasmErrors).toHaveLength(1);
      expect(wasmErrors[0]!.code).toBe(CoreErrorCodes.FRAME_LOOP_ERROR);
      expect(wasmErrors[0]!.message).toContain('audio step failed');
    });
  });

  describe('plugin:error hook', () => {
    it('fires plugin:error hook when a plugin throws and does not recover', async () => {
      const hookFired = vi.fn();
      const plugin: GwenPlugin = {
        name: 'hook-test-plugin',
        setup() {},
        onUpdate() {
          throw new Error('hook trigger');
        },
      };
      const engine = await createEngine();
      engine.hooks.hook('plugin:error', hookFired);
      await engine.use(plugin);
      await engine.advance(16);

      expect(hookFired).toHaveBeenCalledOnce();
    });

    it('does not fire plugin:error hook when plugin calls recover()', async () => {
      const hookFired = vi.fn();
      const plugin: GwenPlugin = {
        name: 'recovering-hook-plugin',
        setup() {},
        onUpdate() {
          throw new Error('recoverable');
        },
        onError(_err, ctx) {
          ctx.recover();
        },
      };
      const engine = await createEngine();
      engine.hooks.hook('plugin:error', hookFired);
      await engine.use(plugin);
      await engine.advance(16);

      expect(hookFired).not.toHaveBeenCalled();
    });

    it('hook payload contains pluginName, phase, error, frame', async () => {
      let payload:
        | {
            pluginName: string;
            phase: string;
            error: unknown;
            frame: number;
          }
        | undefined;

      const plugin: GwenPlugin = {
        name: 'payload-check-plugin',
        setup() {},
        onAfterUpdate() {
          throw new Error('payload test error');
        },
      };
      const engine = await createEngine();
      engine.hooks.hook('plugin:error', (p) => {
        payload = p;
      });
      await engine.use(plugin);
      await engine.advance(16);

      expect(payload).toBeDefined();
      expect(payload!.pluginName).toBe('payload-check-plugin');
      expect(payload!.phase).toBe('onAfterUpdate');
      expect((payload!.error as Error).message).toBe('payload test error');
      expect(typeof payload!.frame).toBe('number');
    });
  });

  describe('logger injectable', () => {
    it('engine.inject("logger") returns the engine logger', async () => {
      const engine = await createEngine();
      const logger = engine.inject('logger');
      expect(logger).toBeDefined();
      expect(typeof logger.warn).toBe('function');
      expect(logger).toBe(engine.logger);
    });

    it('child logger from inject has correct source', async () => {
      const engine = await createEngine({ debug: true });
      const logger = engine.inject('logger');
      const sink = vi.fn();
      logger.setSink(sink);

      const child = logger.child('@gwenjs/test');
      child.warn('test');

      expect(sink).toHaveBeenCalledOnce();
      expect(sink.mock.calls[0]![0].source).toBe('@gwenjs/test');
    });
  });

  describe('multiple plugins — isolation', () => {
    it('second plugin still runs when first plugin throws in onBeforeUpdate', async () => {
      const secondCalled = vi.fn();
      const engine = await createEngine();

      await engine.use({
        name: 'first',
        setup() {},
        onBeforeUpdate() {
          throw new Error('first crashed');
        },
      });
      await engine.use({
        name: 'second',
        setup() {},
        onBeforeUpdate() {
          secondCalled();
        },
      });

      await engine.advance(16);
      expect(secondCalled).toHaveBeenCalledOnce();
    });

    it('all three phases (onBeforeUpdate, onUpdate, onRender) are independent', async () => {
      const calls: string[] = [];
      const engine = await createEngine();

      await engine.use({
        name: 'multi-crash',
        setup() {},
        onBeforeUpdate() {
          throw new Error('before crash');
        },
        onUpdate() {
          throw new Error('update crash');
        },
        onRender() {
          throw new Error('render crash');
        },
      });
      await engine.use({
        name: 'recorder',
        setup() {},
        onBeforeUpdate() {
          calls.push('onBeforeUpdate');
        },
        onUpdate() {
          calls.push('onUpdate');
        },
        onRender() {
          calls.push('onRender');
        },
      });

      await engine.advance(16);

      expect(calls).toContain('onBeforeUpdate');
      expect(calls).toContain('onUpdate');
      expect(calls).toContain('onRender');
    });
  });
});
