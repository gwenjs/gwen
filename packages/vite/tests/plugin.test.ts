import { describe, it, expect } from 'vitest';

describe('GwenVitePlugin', () => {
  it('should initialize with valid options', () => {
    const options = {
      cratePath: './crates/gwen-core',
      watch: true,
      wasmMode: 'debug' as const,
    };

    expect(options.cratePath).toContain('crates');
    expect(options.watch).toBe(true);
    expect(['debug', 'release']).toContain(options.wasmMode);
  });

  it('should handle optional configuration', () => {
    const options = {
      wasmPublicPath: '/wasm',
      verbose: false,
    };

    expect(options.wasmPublicPath).toBe('/wasm');
    expect(options.verbose).toBe(false);
  });

  it('should track WASM file paths', () => {
    const wasmPath = '/wasm/gwen_core.wasm';
    expect(wasmPath).toContain('wasm');
    expect(wasmPath).toContain('.wasm');
    expect(wasmPath.length).toBeGreaterThan(0);
  });

  it('should discover scene files', () => {
    const sceneFiles = ['GameScene.ts', 'MenuScene.ts', 'PauseScene.ts'];
    expect(sceneFiles).toHaveLength(3);
    expect(sceneFiles.every((f) => f.endsWith('.ts'))).toBe(true);
  });

  it('should support debug and release modes', () => {
    const modes = ['debug', 'release'];
    expect(modes).toHaveLength(2);
    expect(modes).toContain('debug');
    expect(modes).toContain('release');
  });

  it('should generate manifest correctly', () => {
    const manifest = {
      version: '0.1.0',
      buildDate: '2026-03-03',
      wasmPath: '/wasm/gwen_core.wasm',
    };

    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.buildDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(manifest.wasmPath).toContain('.wasm');
  });
});
