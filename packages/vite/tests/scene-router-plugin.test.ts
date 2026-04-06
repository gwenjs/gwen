import { describe, it, expect } from 'vitest';
import { generateRouterDevtools, transformRouterNames } from '../src/plugins/scene-router.js';

describe('transformRouterNames()', () => {
  it('injects __routerName__ for const declaration', () => {
    const input = `export const AppRouter = defineSceneRouter({ initial: 'menu', routes: {} })`;
    const output = transformRouterNames(input);
    expect(output).toContain('Object.assign');
    expect(output).toContain('__routerName__');
    expect(output).toContain('"AppRouter"');
  });

  it('handles multiline defineSceneRouter call', () => {
    const input = `
export const MyRouter = defineSceneRouter({
  initial: 'start',
  routes: { start: { scene: StartScene, on: {} } }
})`;
    const output = transformRouterNames(input);
    expect(output).toContain('__routerName__');
    expect(output).toContain('"MyRouter"');
  });

  it('does not transform files without defineSceneRouter', () => {
    const input = `export const x = 42;`;
    expect(transformRouterNames(input)).toBe(input);
  });
});

describe('generateRouterDevtools()', () => {
  it('returns a string with window.__GWEN_ROUTER__ assignment', () => {
    const output = generateRouterDevtools();
    expect(output).toContain('window.__GWEN_ROUTER__');
    expect(output).toContain('current');
    expect(output).toContain('send');
  });
});
