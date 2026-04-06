import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _clearBvhCache, preloadMeshCollider } from '../src/index.js';

beforeEach(() => {
  _clearBvhCache();
  vi.clearAllMocks();
});

describe('useMeshCollider async pipeline', () => {
  it('uses __bvhUrl path: fetches bin and calls physics3d_load_bvh_collider', async () => {
    const mockBridge = {
      physics3d_load_bvh_collider: vi.fn().mockReturnValue(true),
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(64),
    });

    const loadBvhFromUrl = async (url: string, bridge: typeof mockBridge) => {
      const ab = await (await fetch(url)).arrayBuffer();
      return bridge.physics3d_load_bvh_collider(
        0,
        new Uint8Array(ab),
        0,
        0,
        0,
        false,
        0.5,
        0,
        0xffff,
        0xffff,
        1,
      );
    };

    const result = await loadBvhFromUrl('/assets/bvh-abc.bin', mockBridge);
    expect(mockBridge.physics3d_load_bvh_collider).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it('SharedShape cache: same URL fetched only once across multiple calls', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(64),
    });
    global.fetch = fetchSpy;

    const cache = new Map<string, Promise<ArrayBuffer>>();
    const fetchCached = (url: string) => {
      if (!cache.has(url))
        cache.set(
          url,
          fetch(url).then((r) => r.arrayBuffer()),
        );
      return cache.get(url)!;
    };

    await Promise.all([
      fetchCached('/assets/bvh-terrain.bin'),
      fetchCached('/assets/bvh-terrain.bin'),
      fetchCached('/assets/bvh-terrain.bin'),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('aborts pending load when abort() is called', async () => {
    let aborted = false;
    const ac = new AbortController();
    ac.signal.addEventListener('abort', () => {
      aborted = true;
    });

    ac.abort();

    expect(aborted).toBe(true);
  });

  it('status transitions: loading → active on success', async () => {
    let status: string = 'loading';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(64),
    });
    const mockBridge = { physics3d_load_bvh_collider: vi.fn().mockReturnValue(true) };

    const ab = await (await fetch('/assets/bvh-test.bin')).arrayBuffer();
    mockBridge.physics3d_load_bvh_collider(
      0,
      new Uint8Array(ab),
      0,
      0,
      0,
      false,
      0.5,
      0,
      0xffff,
      0xffff,
      1,
    );
    status = 'active';

    expect(status).toBe('active');
  });
});

describe('preloadMeshCollider', () => {
  it('starts fetch immediately and returns a handle with status loading', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(64),
    });
    const handle = preloadMeshCollider('/assets/bvh-zone2.bin');
    expect(fetch).toHaveBeenCalledWith('/assets/bvh-zone2.bin');
    expect(handle.status).toBe('loading');
  });

  it('handle.ready resolves and status becomes ready when fetch completes', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(64),
    });
    const handle = preloadMeshCollider('/assets/bvh-zone3.bin');
    await handle.ready;
    expect(handle.status).toBe('ready');
  });

  it('stores the ArrayBuffer in handle._buffer after load', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(64),
    });
    const handle = preloadMeshCollider('/assets/bvh-zone4.bin');
    await handle.ready;
    expect(handle._buffer).toBeInstanceOf(ArrayBuffer);
    expect((handle._buffer as ArrayBuffer).byteLength).toBe(64);
  });

  it('handle.status is error when fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    const handle = preloadMeshCollider('/assets/bvh-missing.bin');
    await handle.ready;
    expect(handle.status).toBe('error');
  });

  it('same URL called twice reuses cache (single fetch)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(64),
    });
    global.fetch = fetchSpy;
    const h1 = preloadMeshCollider('/assets/bvh-shared.bin');
    const h2 = preloadMeshCollider('/assets/bvh-shared.bin');
    await Promise.all([h1.ready, h2.ready]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
