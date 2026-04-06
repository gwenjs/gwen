import { describe, it, expect } from 'vitest';
import * as core from '../src/index';

describe('API surface (RFC-V2-013)', () => {
  it('exports stable V2 runtime entrypoints', () => {
    expect(typeof core.createEngine).toBe('function');
    expect(typeof core.initWasm).toBe('function');
    expect(typeof core.getWasmBridge).toBe('function');
    expect(typeof core.defineSystem).toBe('function');
    expect(typeof core.defineScene).toBe('function');
    expect(typeof core.definePrefab).toBe('function');
    expect(typeof core.detectCoreVariant).toBe('function');
    expect(typeof core.detectSharedMemoryRequired).toBe('function');
  });

  it('does not expose legacy V1 engine infrastructure', () => {
    expect('Engine' in core).toBe(false);
    expect('PluginManager' in core).toBe(false);
    expect('ServiceLocator' in core).toBe(false);
    expect('EngineAPIImpl' in core).toBe(false);
    expect('createEngineAPI' in core).toBe(false);
    expect('loadWasmPlugin' in core).toBe(false);
    expect('PluginDataBus' in core).toBe(false);
    expect('isWasmPlugin' in core).toBe(false);
    expect('ConfigBuilder' in core).toBe(false);
  });
});
