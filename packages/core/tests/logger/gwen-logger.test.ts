import { describe, it, expect, vi } from 'vitest';
import { GwenLogger } from '../../src/logger/gwen-logger';
import type { IGwenLogProvider, GwenLogEntry } from '@gwenjs/schema';

function makeProvider(): { entries: GwenLogEntry[]; provider: IGwenLogProvider } {
  const entries: GwenLogEntry[] = [];
  return { entries, provider: { handle: (e) => entries.push(e) } };
}

describe('GwenLogger', () => {
  it('emits entries to all providers', () => {
    const p1 = makeProvider();
    const p2 = makeProvider();
    const log = new GwenLogger([p1.provider, p2.provider], 'debug');
    log.info('hello');
    expect(p1.entries).toHaveLength(1);
    expect(p2.entries).toHaveLength(1);
  });

  it('filters entries below minLevel', () => {
    const { entries, provider } = makeProvider();
    const log = new GwenLogger([provider], 'warn');
    log.debug('ignored');
    log.info('ignored');
    log.warn('kept');
    log.error('kept');
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.level)).toEqual(['warn', 'error']);
  });

  it('includes tag and entityId in child logger entries', () => {
    const { entries, provider } = makeProvider();
    const log = new GwenLogger([provider], 'debug');
    const child = log.child('actor:Player', '42');
    child.info('spawned');
    expect(entries[0]!.tag).toBe('actor:Player');
    expect(entries[0]!.entityId).toBe('42');
  });

  it('includes payload in entries', () => {
    const { entries, provider } = makeProvider();
    const log = new GwenLogger([provider], 'debug');
    log.warn('low hp', { hp: 5 });
    expect(entries[0]!.payload).toEqual({ hp: 5 });
  });

  it('includes a timestamp', () => {
    const { entries, provider } = makeProvider();
    const log = new GwenLogger([provider], 'debug');
    log.info('test');
    expect(typeof entries[0]!.timestamp).toBe('number');
  });
});
