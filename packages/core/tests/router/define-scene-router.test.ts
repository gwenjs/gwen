import { describe, it, expect } from 'vitest';
import { defineScene } from '../../src/scene/define-scene.js';
import { defineSceneRouter } from '../../src/router/define-scene-router.js';

const MenuScene = defineScene({ name: 'Menu', systems: [] });
const GameScene = defineScene({ name: 'Game', systems: [] });
const PauseScene = defineScene({ name: 'Pause', systems: [] });

describe('defineSceneRouter()', () => {
  it('returns a SceneRouterDefinition with __type marker', () => {
    const router = defineSceneRouter({
      initial: 'menu',
      routes: {
        menu: { scene: MenuScene, on: { PLAY: 'game' } },
        game: { scene: GameScene, on: { PAUSE: 'pause' } },
        pause: { scene: PauseScene, overlay: true, on: { RESUME: 'game' } },
      },
    });
    expect(router.__type).toBe('SceneRouterDefinition');
  });

  it('stores the options as-is', () => {
    const options = {
      initial: 'menu' as const,
      routes: {
        menu: { scene: MenuScene, on: { PLAY: 'game' as const } },
        game: { scene: GameScene, on: {} },
      },
    };
    const router = defineSceneRouter(options);
    expect(router.options).toBe(options);
  });

  it('throws if initial state is not a key in routes', () => {
    expect(() =>
      defineSceneRouter({
        initial: 'unknown' as any,
        routes: {
          menu: { scene: MenuScene, on: {} },
        },
      }),
    ).toThrow(/initial.*not found/i);
  });

  it('throws if a transition target is not a valid route key', () => {
    expect(() =>
      defineSceneRouter({
        initial: 'menu',
        routes: {
          menu: { scene: MenuScene, on: { PLAY: 'nonexistent' as any } },
        },
      }),
    ).toThrow(/transition.*nonexistent/i);
  });
});
