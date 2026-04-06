/**
 * @file Phase 3 (RFC-11) — debug mode activation tests.
 *
 * Covers:
 * - engine.debug flag default and opt-in
 * - logger level gating (debug/info silent in prod, warn/error always active)
 * - plugin-registration log in debug mode
 * - over-budget phase warning in debug mode
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEngine } from '../src/engine/gwen-engine';

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── engine.debug flag ────────────────────────────────────────────────────────

describe('engine.debug flag', () => {
  it('is false by default', async () => {
    const engine = await createEngine();
    expect(engine.debug).toBe(false);
  });

  it('is true when createEngine({ debug: true })', async () => {
    const engine = await createEngine({ debug: true });
    expect(engine.debug).toBe(true);
  });

  it('is accessible on the engine instance as a boolean', async () => {
    const engine = await createEngine({ debug: true });
    expect(typeof engine.debug).toBe('boolean');
  });
});

// ─── logger level gating ─────────────────────────────────────────────────────

describe('logger level gating', () => {
  it('debug and info are silent when debug mode is off', async () => {
    const engine = await createEngine({ debug: false });
    const levels: string[] = [];
    engine.logger.setSink((entry) => levels.push(entry.level));

    engine.logger.debug('test-debug');
    engine.logger.info('test-info');

    expect(levels).toEqual([]);
  });

  it('debug and info reach the sink when debug mode is on', async () => {
    const engine = await createEngine({ debug: true });
    const levels: string[] = [];
    engine.logger.setSink((entry) => levels.push(entry.level));

    engine.logger.debug('test-debug');
    engine.logger.info('test-info');

    expect(levels).toEqual(['debug', 'info']);
  });

  it('warn and error always reach the sink regardless of debug mode', async () => {
    const engine = await createEngine({ debug: false });
    const levels: string[] = [];
    engine.logger.setSink((entry) => levels.push(entry.level));

    engine.logger.warn('test-warn');
    engine.logger.error('test-error');

    expect(levels).toEqual(['warn', 'error']);
  });

  it('warn and error also reach the sink in debug mode', async () => {
    const engine = await createEngine({ debug: true });
    const levels: string[] = [];
    engine.logger.setSink((entry) => levels.push(entry.level));

    engine.logger.warn('test-warn');
    engine.logger.error('test-error');

    expect(levels).toEqual(['warn', 'error']);
  });
});

// ─── plugin setup logging ─────────────────────────────────────────────────────

describe('plugin setup logging', () => {
  it('logs "plugin registered: <name>" for each plugin when debug mode is on', async () => {
    const engine = await createEngine({ debug: true });
    const messages: string[] = [];
    engine.logger.setSink((entry) => messages.push(entry.message));

    await engine.use({ name: 'test-plugin', setup() {} });

    expect(messages.some((m) => m.includes('plugin registered') && m.includes('test-plugin'))).toBe(
      true,
    );
  });

  it('does not log plugin registration when debug mode is off', async () => {
    const engine = await createEngine({ debug: false });
    const messages: string[] = [];
    engine.logger.setSink((entry) => messages.push(entry.message));

    await engine.use({ name: 'test-plugin', setup() {} });

    // warn/error are always active but there should be no "plugin registered" message
    expect(messages.some((m) => m.includes('plugin registered'))).toBe(false);
  });

  it('logs each plugin by name when multiple plugins are registered in debug mode', async () => {
    const engine = await createEngine({ debug: true });
    const messages: string[] = [];
    engine.logger.setSink((entry) => messages.push(entry.message));

    await engine.use({ name: 'alpha', setup() {} });
    await engine.use({ name: 'beta', setup() {} });

    expect(messages.some((m) => m.includes('alpha'))).toBe(true);
    expect(messages.some((m) => m.includes('beta'))).toBe(true);
  });
});

// ─── over-budget phase warning ────────────────────────────────────────────────

describe('over-budget phase warning', () => {
  it('does not emit phase warnings when debug mode is off', async () => {
    const engine = await createEngine({ debug: false, targetFPS: 60 });
    const warnings: string[] = [];
    engine.logger.setSink((entry) => {
      if (entry.level === 'warn') warnings.push(entry.message);
    });

    // Make every performance.now() call advance by 10 ms so every phase looks slow
    let callCount = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => callCount++ * 10);

    await engine.advance(16.67);

    expect(warnings.length).toBe(0);
  });

  it('emits warn logs when a phase exceeds 50% of the frame budget in debug mode', async () => {
    const engine = await createEngine({ debug: true, targetFPS: 60 });
    const warnings: string[] = [];
    engine.logger.setSink((entry) => {
      if (entry.level === 'warn') warnings.push(entry.message);
    });

    // Simulate each phase taking 10 ms: any phase > 8.33 ms (50% of 16.67 ms) triggers warning
    let callCount = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => callCount++ * 10);

    await engine.advance(16.67);

    expect(warnings.length).toBeGreaterThan(0);
    // Each warning message should contain the word "exceeded"
    expect(warnings.every((m) => m.includes('exceeded'))).toBe(true);
  });

  it('warning entries include phase, ms, budgetMs, and frame context data', async () => {
    const engine = await createEngine({ debug: true, targetFPS: 60 });
    const entries: Array<{ message: string; data?: Record<string, unknown> }> = [];
    engine.logger.setSink((entry) => {
      if (entry.level === 'warn') entries.push({ message: entry.message, data: entry.data });
    });

    let callCount = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => callCount++ * 10);

    await engine.advance(16.67);

    // At least one warning entry should carry structured context
    const withData = entries.filter((e) => e.data !== undefined);
    expect(withData.length).toBeGreaterThan(0);
    const first = withData[0]!;
    expect(first.data).toHaveProperty('phase');
    expect(first.data).toHaveProperty('ms');
    expect(first.data).toHaveProperty('budgetMs');
    expect(first.data).toHaveProperty('frame');
  });

  it('does not crash when debug mode is on and no plugins are registered', async () => {
    const engine = await createEngine({ debug: true, targetFPS: 60 });
    engine.logger.setSink(() => {}); // silence output

    await expect(engine.advance(16.67)).resolves.not.toThrow();
  });
});
