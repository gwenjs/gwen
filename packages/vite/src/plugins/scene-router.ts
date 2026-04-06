import type { Plugin } from 'vite';
import type { GwenViteOptions } from '../types.js';

/**
 * Options for the `gwen:scene-router` sub-plugin.
 */
export interface GwenSceneRouterOptions {
  /** Disable debug name injection. @default false */
  disableNameInjection?: boolean;
}

/**
 * Injects debug names into `defineSceneRouter(...)` calls using `Object.assign()`.
 *
 * For each `const Foo = defineSceneRouter(...)` pattern, wraps the call with:
 * `Object.assign(defineSceneRouter(...), { __routerName__: 'Foo' })`
 *
 * This allows runtime tools to surface human-readable router names for debugging.
 *
 * @param code - Source code to transform.
 * @returns Transformed source code (same reference if no patterns found).
 *
 * @example
 * ```ts
 * transformRouterNames(`const AppRouter = defineSceneRouter({ ... })`);
 * // => `const AppRouter = Object.assign(defineSceneRouter({ ... }), { __routerName__: 'AppRouter' })`
 * ```
 */
export function transformRouterNames(code: string): string {
  if (!code.includes('defineSceneRouter')) {
    return code;
  }
  // Handles: const Name = defineSceneRouter(...)
  const pattern = /(\bconst\s+(\w+)\s*=\s*)defineSceneRouter(\s*\((?:[^()]*|\([^()]*\))*?\))/g;
  return code.replace(pattern, (match, prefix, name, defCall) => {
    return `${prefix}Object.assign(defineSceneRouter${defCall}, { __routerName__: "${name}" })`;
  });
}

/**
 * Generates a devtools script for the GWEN scene router.
 *
 * @returns JavaScript string to inject into the page.
 */
export function generateRouterDevtools(): string {
  return `
if (typeof window !== 'undefined') {
  window.__GWEN_ROUTER__ = {
    get current() {
      return window.__GWEN_ROUTER_INSTANCE__?.current ?? '(no router active)';
    },
    send(event, params) {
      if (window.__GWEN_ROUTER_INSTANCE__) {
        window.__GWEN_ROUTER_INSTANCE__.send(event, params);
      } else {
        console.warn('[GWEN DevTools] No router registered.');
      }
    },
    can(event) {
      return window.__GWEN_ROUTER_INSTANCE__?.can(event) ?? false;
    },
  };
}
`;
}

/**
 * GWEN sub-plugin for scene router debug name injection and devtools.
 *
 * @param options - Top-level GWEN Vite plugin options.
 * @returns Vite plugin instance.
 */
export function gwenSceneRouterPlugin(options: GwenViteOptions = {}): Plugin {
  const disableNameInjection = options.sceneRouter?.disableNameInjection ?? false;
  return {
    name: 'gwen:scene-router',
    transform(code, id) {
      if (disableNameInjection) return;
      if (!/\.(ts|js)x?$/.test(id)) return;
      if (!code.includes('defineSceneRouter')) return;
      const transformed = transformRouterNames(code);
      if (transformed === code) return;
      return { code: transformed, map: null };
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server && ctx.server.config.command === 'serve') {
          return html.replace(/<head>/i, `<head>\n<script>${generateRouterDevtools()}</script>`);
        }
      },
    },
  };
}
