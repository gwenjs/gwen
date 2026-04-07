/**
 * @file useShape() composable tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEngine = {
  addComponent: vi.fn(),
};

vi.mock('@gwenjs/core', () => ({
  useEngine: vi.fn(() => mockEngine),
}));

vi.mock('@gwenjs/core/actor', () => ({
  _getActorEntityId: vi.fn(() => 42n),
}));

vi.mock('../../src/shape-component.js', () => ({
  ShapeComponent: { name: 'Shape', schema: {} },
}));

import { useShape } from '../../src/composables/use-shape.js';

describe('useShape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls engine.addComponent with the ShapeComponent', () => {
    useShape({ w: 100, h: 50 });
    expect(mockEngine.addComponent).toHaveBeenCalledOnce();
    expect(mockEngine.addComponent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Shape' }),
      expect.anything(),
    );
  });

  it('passes w and h values to the component', () => {
    useShape({ w: 200, h: 80 });
    expect(mockEngine.addComponent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ w: 200, h: 80 }),
    );
  });

  it('passes radius value to the component', () => {
    useShape({ radius: 32 });
    expect(mockEngine.addComponent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ radius: 32 }),
    );
  });

  it('passes depth value to the component', () => {
    useShape({ depth: 16 });
    expect(mockEngine.addComponent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ depth: 16 }),
    );
  });

  it('defaults w, h, radius and depth to 0 when not provided', () => {
    useShape({});
    expect(mockEngine.addComponent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { w: 0, h: 0, radius: 0, depth: 0 },
    );
  });

  it('defaults missing fields to 0 when only some are provided', () => {
    useShape({ w: 64 });
    expect(mockEngine.addComponent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { w: 64, h: 0, radius: 0, depth: 0 },
    );
  });

  it('uses the entity id from _getActorEntityId', async () => {
    const { _getActorEntityId } = await import('@gwenjs/core/actor');
    vi.mocked(_getActorEntityId).mockReturnValue(99n);

    useShape({ w: 10 });

    expect(mockEngine.addComponent).toHaveBeenCalledWith(
      99n,
      expect.anything(),
      expect.anything(),
    );
  });

  it('passes all four fields together correctly', () => {
    useShape({ w: 800, h: 32, radius: 5, depth: 10 });
    expect(mockEngine.addComponent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { w: 800, h: 32, radius: 5, depth: 10 },
    );
  });
});
