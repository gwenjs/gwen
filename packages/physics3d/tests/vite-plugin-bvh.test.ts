import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createGwenPhysics3DPlugin, _setBuildToolsLoader, transformBvhReferences } from '../src/vite-plugin.js';

// Inject a mock build-tools WASM loader (avoids needing the actual build artifact)
beforeAll(() => {
  _setBuildToolsLoader(async () => ({
    build_bvh_from_glb: (_bytes: Uint8Array, _name?: string) => {
      const buf = new Uint8Array(16);
      buf[0] = 0x47; // G
      buf[1] = 0x42; // B
      buf[2] = 0x56; // V
      buf[3] = 0x48; // H
      return buf;
    },
  }));
});

// Mock node:fs so existsSync / readFileSync succeed in tests
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue(Buffer.from([])),
}));

describe('gwen:physics3d Vite plugin — BVH transform', () => {
  it('transforms useMeshCollider string arg to __bvhUrl', async () => {
    const plugin = createGwenPhysics3DPlugin();
    const code = `useMeshCollider('./terrain.glb')`;
    const result = await plugin.transformBvhReferences?.(code, 'src/game.ts');
    expect(result).toContain('__bvhUrl');
  });

  it('leaves dynamic useMeshCollider({ vertices, indices }) untouched', async () => {
    const plugin = createGwenPhysics3DPlugin();
    const code = `useMeshCollider({ vertices: v, indices: i })`;
    const result = await plugin.transformBvhReferences?.(code, 'src/game.ts');
    expect(result).toBeNull();
  });

  it('plugin has name gwen:physics3d', () => {
    const plugin = createGwenPhysics3DPlugin();
    expect(plugin.name).toBe('gwen:physics3d');
  });

  it('replaces GLB path with __bvhUrl asset name pattern', async () => {
    const plugin = createGwenPhysics3DPlugin();
    const code = `useMeshCollider('./level.glb')`;
    const result = await plugin.transformBvhReferences?.(code, '/project/src/game.ts');
    expect(result).toMatch(/bvh-[0-9a-f]{8}\.bin/);
  });

  it('handles useConvexCollider GLB path too', async () => {
    const plugin = createGwenPhysics3DPlugin();
    const code = `useConvexCollider('./prop.glb')`;
    const result = await plugin.transformBvhReferences?.(code, 'src/game.ts');
    expect(result).toContain('__bvhUrl');
  });

  it('returns null when no GLB patterns present', async () => {
    const plugin = createGwenPhysics3DPlugin();
    const code = `useMeshCollider({ vertices: new Float32Array(), indices: new Uint32Array() })`;
    const result = await plugin.transformBvhReferences?.(code, 'src/game.ts');
    expect(result).toBeNull();
  });
});

// ─── Step 10 — Error handling: missing GLB file ───────────────────────────────

import * as nodeFsMock from 'node:fs';

describe('gwen:physics3d — BVH error handling', () => {
  it('logs a warning and skips when the GLB file does not exist', async () => {
    // Temporarily make existsSync return false (file missing)
    vi.mocked(nodeFsMock.existsSync).mockReturnValueOnce(false);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const code = `useMeshCollider('./terrain.glb')`;
      const result = await transformBvhReferences(code, '/project/src/game.ts');

      // The plugin warns about the missing file
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[gwen:physics3d]'),
      );
      // All matches were skipped → code unchanged → null
      expect(result).toBeNull();
    } finally {
      warnSpy.mockRestore();
      // Restore default mock behaviour (existsSync → true)
      vi.mocked(nodeFsMock.existsSync).mockReturnValue(true);
    }
  });

  it('does not throw when build_bvh_from_glb throws (bad GLB bytes)', async () => {
    // Inject a loader that throws on every call
    _setBuildToolsLoader(async () => ({
      build_bvh_from_glb: () => {
        throw new Error('invalid GLB magic');
      },
    }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const code = `useMeshCollider('./terrain.glb')`;
      // Must not throw — the plugin catches exceptions from build_bvh_from_glb
      await expect(
        transformBvhReferences(code, '/project/src/game.ts'),
      ).resolves.toBeNull();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('BVH pre-bake failed'),
      );
    } finally {
      warnSpy.mockRestore();
      // Restore working loader for subsequent tests
      _setBuildToolsLoader(async () => ({
        build_bvh_from_glb: (_bytes: Uint8Array) => new Uint8Array(16),
      }));
    }
  });
});
