import { describe, it, expect, vi } from 'vitest';
import { createEngine } from '../../src/engine/gwen-engine.js';
import { defineScene } from '../../src/scene/define-scene.js';
import { defineSceneRouter } from '../../src/router/define-scene-router.js';
import { useSceneRouter } from '../../src/router/use-scene-router.js';

const onEnterMenu = vi.fn();
const onExitMenu = vi.fn();
const onEnterGame = vi.fn();

const MenuScene = defineScene({
  name: 'Menu',
  systems: [],
  onEnter: onEnterMenu,
  onExit: onExitMenu,
});
const GameScene = defineScene({ name: 'Game', systems: [], onEnter: onEnterGame });
const PauseScene = defineScene({ name: 'Pause', systems: [] });

const AppRouter = defineSceneRouter({
  initial: 'menu',
  routes: {
    menu: { scene: MenuScene, on: { PLAY: 'game' } },
    game: { scene: GameScene, on: { PAUSE: 'pause', WIN: 'menu' } },
    pause: { scene: PauseScene, overlay: true, on: { RESUME: 'game', QUIT: 'menu' } },
  },
});

describe('useSceneRouter()', () => {
  it('starts in the initial state', async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      expect(nav.current).toBe('menu');
    });
  });

  it('send() transitions to new state', async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      await nav.send('PLAY');
      expect(nav.current).toBe('game');
    });
  });

  it('send() calls onExit of previous scene and onEnter of next', async () => {
    onEnterMenu.mockClear();
    onExitMenu.mockClear();
    onEnterGame.mockClear();
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      await nav.send('PLAY');
      expect(onExitMenu).toHaveBeenCalledOnce();
      expect(onEnterGame).toHaveBeenCalledOnce();
    });
  });

  it('send() passes params to onEnter of target scene', async () => {
    const onEnterSpy = vi.fn();
    const SceneA = defineScene({ name: 'A', systems: [] });
    const SceneB = defineScene({ name: 'B', systems: [], onEnter: onEnterSpy });
    const router = defineSceneRouter({
      initial: 'a',
      routes: {
        a: { scene: SceneA, on: { GO: 'b' } },
        b: { scene: SceneB, on: {} },
      },
    });
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(router);
      await nav.send('GO', { level: 2, score: 999 });
    });
    expect(onEnterSpy).toHaveBeenCalledWith(expect.objectContaining({ level: 2, score: 999 }));
  });

  it('send() with invalid event is silently ignored', async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      // 'WIN' is not valid in 'menu' state
      await expect(nav.send('WIN' as any)).resolves.toBeUndefined();
      expect(nav.current).toBe('menu');
    });
  });

  it('can() returns true only for valid transitions in current state', async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      expect(nav.can('PLAY')).toBe(true);
      expect(nav.can('WIN' as any)).toBe(false);
    });
  });

  it('onTransition() callback is called on state change', async () => {
    const engine = await createEngine();
    const transitions: [string, string][] = [];
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      nav.onTransition((from, to) => transitions.push([from, to]));
      await nav.send('PLAY');
    });
    expect(transitions).toEqual([['menu', 'game']]);
  });

  it('overlay: true pushes scene on stack, RESUME pops back', async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      await nav.send('PLAY');
      expect(nav.current).toBe('game');
      await nav.send('PAUSE');
      expect(nav.current).toBe('pause');
      await nav.send('RESUME');
      expect(nav.current).toBe('game');
    });
  });

  it('params are stored and accessible after send()', async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      await nav.send('PLAY', { debug: true });
      expect(nav.params).toEqual({ debug: true });
    });
  });

  it('throws if used outside engine context', () => {
    expect(() => useSceneRouter(AppRouter)).toThrow(/useSceneRouter.*engine/i);
  });
});
