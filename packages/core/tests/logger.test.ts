/**
 * Tests for GwenLogger (RFC-011 Phase 1)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger } from '../src/logger/index';
import { createEngine } from '../src/index';
import type { LogEntry } from '../src/logger/index';

describe('GwenLogger', () => {
  describe('sink routing', () => {
    it('does not call the sink for debug/info when debug mode is off', () => {
      const sink = vi.fn();
      const logger = createLogger('test', false);
      logger.setSink(sink);

      logger.debug('hello debug');
      logger.info('hello info');

      expect(sink).not.toHaveBeenCalled();
    });

    it('calls the sink for warn/error regardless of debug mode', () => {
      const sink = vi.fn();
      const logger = createLogger('test', false);
      logger.setSink(sink);

      logger.warn('a warning');
      logger.error('an error');

      expect(sink).toHaveBeenCalledTimes(2);
      expect(sink.mock.calls[0]![0]).toMatchObject({ level: 'warn', message: 'a warning' });
      expect(sink.mock.calls[1]![0]).toMatchObject({ level: 'error', message: 'an error' });
    });

    it('calls the sink for all levels when debug mode is on', () => {
      const sink = vi.fn();
      const logger = createLogger('test', true);
      logger.setSink(sink);

      logger.debug('dbg');
      logger.info('inf');
      logger.warn('wrn');
      logger.error('err');

      expect(sink).toHaveBeenCalledTimes(4);
    });
  });

  describe('child()', () => {
    it('child logger uses the provided source name', () => {
      const sink = vi.fn();
      const parent = createLogger('parent', true);
      parent.setSink(sink);

      const child = parent.child('@gwenjs/physics2d');
      child.warn('collision detected');

      expect(sink).toHaveBeenCalledOnce();
      const entry: LogEntry = sink.mock.calls[0]![0];
      expect(entry.source).toBe('@gwenjs/physics2d');
    });

    it('child shares the same sink as the parent', () => {
      const sink = vi.fn();
      const parent = createLogger('parent', true);
      parent.setSink(sink);

      const child = parent.child('child-source');
      parent.warn('from parent');
      child.warn('from child');

      expect(sink).toHaveBeenCalledTimes(2);
    });

    it('setSink on a child updates the shared sink', () => {
      const sink1 = vi.fn();
      const sink2 = vi.fn();
      const parent = createLogger('parent', true);
      parent.setSink(sink1);

      const child = parent.child('child-source');
      child.setSink(sink2);

      parent.warn('after child setSink');
      child.warn('also after child setSink');

      expect(sink1).not.toHaveBeenCalled();
      expect(sink2).toHaveBeenCalledTimes(2);
    });
  });

  describe('setSink()', () => {
    it('replaces the sink — subsequent entries go to the new sink', () => {
      const sink1 = vi.fn();
      const sink2 = vi.fn();
      const logger = createLogger('test', true);
      logger.setSink(sink1);

      logger.warn('before');
      logger.setSink(sink2);
      logger.warn('after');

      expect(sink1).toHaveBeenCalledTimes(1);
      expect(sink2).toHaveBeenCalledTimes(1);
    });

    it('sink receives correct LogEntry shape (level, source, message, ts)', () => {
      const sink = vi.fn();
      const logger = createLogger('my-source', true);
      logger.setSink(sink);

      logger.warn('test message', { key: 'value' });

      expect(sink).toHaveBeenCalledOnce();
      const entry: LogEntry = sink.mock.calls[0]![0];
      expect(entry.level).toBe('warn');
      expect(entry.source).toBe('my-source');
      expect(entry.message).toBe('test message');
      expect(entry.data).toEqual({ key: 'value' });
      expect(typeof entry.ts).toBe('number');
      expect(entry.ts).toBeGreaterThan(0);
    });

    it('frame is included when getFrame callback is provided', () => {
      const sink = vi.fn();
      let frame = 42;
      const logger = createLogger('test', true, () => frame);
      logger.setSink(sink);

      logger.warn('frame test');

      expect(sink).toHaveBeenCalledOnce();
      expect(sink.mock.calls[0]![0].frame).toBe(42);

      frame = 99;
      logger.warn('next frame');
      expect(sink.mock.calls[1]![0].frame).toBe(99);
    });
  });

  describe('engine.logger integration', () => {
    it('engine.logger is available after createEngine()', async () => {
      const engine = await createEngine();
      expect(engine.logger).toBeDefined();
      expect(typeof engine.logger.debug).toBe('function');
      expect(typeof engine.logger.child).toBe('function');
    });

    it('engine.logger.child() produces a scoped logger', async () => {
      const engine = await createEngine({ debug: true });
      const sink = vi.fn();
      engine.logger.setSink(sink);

      const child = engine.logger.child('@gwenjs/test-plugin');
      child.warn('child message');

      expect(sink).toHaveBeenCalledOnce();
      expect(sink.mock.calls[0]![0].source).toBe('@gwenjs/test-plugin');
    });

    it('debug mode off: engine.logger.debug() is silent', async () => {
      const engine = await createEngine({ debug: false });
      const sink = vi.fn();
      engine.logger.setSink(sink);

      engine.logger.debug('this should be silent');
      engine.logger.info('this too');

      expect(sink).not.toHaveBeenCalled();
    });

    it('debug mode on: engine.logger.debug() reaches the sink', async () => {
      const engine = await createEngine({ debug: true });
      const sink = vi.fn();
      engine.logger.setSink(sink);

      engine.logger.debug('visible in debug mode');

      expect(sink).toHaveBeenCalledOnce();
      expect(sink.mock.calls[0]![0].message).toBe('visible in debug mode');
    });
  });
});
