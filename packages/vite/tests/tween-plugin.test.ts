import { describe, it, expect } from 'vitest';
import { extractUsedEasings, gwenTweenPlugin } from '../src/plugins/tween.js';
import type { GwenViteOptions } from '../src/types.js';

// ── extractUsedEasings ────────────────────────────────────────────────────────

describe('extractUsedEasings()', () => {
  it('returns an empty set for empty input', () => {
    const result = extractUsedEasings('');
    expect(result.size).toBe(0);
  });

  it('returns an empty set for code with no easing property', () => {
    const code = `useTween({ duration: 1.0 })`;
    expect(extractUsedEasings(code).size).toBe(0);
  });

  it('extracts a single easing name from single-quoted literal', () => {
    const code = `useTween({ duration: 0.4, easing: 'easeOutQuad' })`;
    const result = extractUsedEasings(code);
    expect([...result]).toEqual(['easeOutQuad']);
  });

  it('extracts a single easing name from double-quoted literal', () => {
    const code = `useTween({ duration: 0.4, easing: "easeInCubic" })`;
    const result = extractUsedEasings(code);
    expect([...result]).toEqual(['easeInCubic']);
  });

  it('extracts multiple unique easing names from multiple useTween calls', () => {
    const code = `
      const a = useTween({ duration: 1, easing: 'linear' });
      const b = useTween({ duration: 2, easing: 'easeInBounce' });
      const c = useTween({ duration: 0.5, easing: 'easeOutElastic' });
    `;
    const result = extractUsedEasings(code);
    expect(result.has('linear')).toBe(true);
    expect(result.has('easeInBounce')).toBe(true);
    expect(result.has('easeOutElastic')).toBe(true);
    expect(result.size).toBe(3);
  });

  it('deduplicates repeated easing names', () => {
    const code = `
      const a = useTween({ duration: 1, easing: 'easeOutQuad' });
      const b = useTween({ duration: 2, easing: 'easeOutQuad' });
    `;
    const result = extractUsedEasings(code);
    expect(result.size).toBe(1);
    expect(result.has('easeOutQuad')).toBe(true);
  });

  it('still extracts an unrecognised (non-standard) easing name — validation is runtime', () => {
    const code = `useTween({ duration: 1, easing: 'myCustomEasing' })`;
    const result = extractUsedEasings(code);
    expect(result.has('myCustomEasing')).toBe(true);
  });

  it('handles whitespace around the colon', () => {
    const code = `useTween({ duration: 1, easing  :  'easeInBack' })`;
    const result = extractUsedEasings(code);
    expect(result.has('easeInBack')).toBe(true);
  });

  it('does not extract dynamic easing (template literal — not supported)', () => {
    // Template literals are not matched by the static regex, which is intentional.
    const code = 'useTween({ duration: 1, easing: `easeOutQuad` })';
    const result = extractUsedEasings(code);
    expect(result.size).toBe(0);
  });

  it('handles all 26 named easing functions', () => {
    const easings = [
      'linear',
      'easeInQuad',
      'easeOutQuad',
      'easeInOutQuad',
      'easeInCubic',
      'easeOutCubic',
      'easeInOutCubic',
      'easeInQuart',
      'easeOutQuart',
      'easeInOutQuart',
      'easeInSine',
      'easeOutSine',
      'easeInOutSine',
      'easeInExpo',
      'easeOutExpo',
      'easeInOutExpo',
      'easeInBack',
      'easeOutBack',
      'easeInOutBack',
      'easeInElastic',
      'easeOutElastic',
      'easeInOutElastic',
      'easeInBounce',
      'easeOutBounce',
      'easeInOutBounce',
      'spring',
    ];
    const code = easings.map((e) => `useTween({ duration: 1, easing: '${e}' })`).join('\n');
    const result = extractUsedEasings(code);
    for (const e of easings) {
      expect(result.has(e)).toBe(true);
    }
    expect(result.size).toBe(easings.length);
  });

  it('does not extract easing from a comment', () => {
    expect([...extractUsedEasings(`// easing: 'easeInOut'`)]).toHaveLength(0);
  });

  it('does not extract easing from a string literal', () => {
    expect([...extractUsedEasings(`const s = "easing: 'linear'";`)]).toHaveLength(0);
  });

  it('extracts easing from a real useTween() call', () => {
    const code = `useTween({ duration: 1, easing: 'easeOutQuad' });`;
    expect([...extractUsedEasings(code)]).toEqual(['easeOutQuad']);
  });
});

// ── gwenTweenPlugin — virtual module ─────────────────────────────────────────

describe('gwenTweenPlugin()', () => {
  /**
   * Helper: create a plugin instance, simulate transforms on provided code
   * snippets, then call load() on the virtual module ID.
   */
  function buildVirtualModule(
    codeSnippets: string[],
    opts: GwenViteOptions = {},
  ): string | null | undefined {
    const plugin = gwenTweenPlugin(opts);

    // Simulate buildStart to reset collected easings.
    if (typeof plugin.buildStart === 'function') {
      // Vite calls buildStart with a `this` context — use an empty object for unit tests.
      (plugin.buildStart as Function).call({});
    }

    // Simulate transform for each snippet.
    if (typeof plugin.transform === 'function') {
      for (let i = 0; i < codeSnippets.length; i++) {
        (plugin.transform as Function).call({}, codeSnippets[i], `file${i}.ts`);
      }
    }

    // Resolve virtual ID.
    const resolved =
      typeof plugin.resolveId === 'function'
        ? (plugin.resolveId as Function).call({}, 'virtual:gwen/used-easings', undefined)
        : null;

    if (!resolved) return null;

    // Load virtual module.
    if (typeof plugin.load === 'function') {
      return (plugin.load as Function).call({}, resolved) as string | null | undefined;
    }
    return null;
  }

  it('has the correct plugin name', () => {
    const plugin = gwenTweenPlugin();
    expect(plugin.name).toBe('gwen:tween');
  });

  it('resolves virtual:gwen/used-easings to internal ID', () => {
    const plugin = gwenTweenPlugin();
    const resolved =
      typeof plugin.resolveId === 'function'
        ? (plugin.resolveId as Function).call({}, 'virtual:gwen/used-easings', undefined)
        : null;
    expect(resolved).toBe('\0virtual:gwen/used-easings');
  });

  it('does not resolve unknown module IDs', () => {
    const plugin = gwenTweenPlugin();
    const resolved =
      typeof plugin.resolveId === 'function'
        ? (plugin.resolveId as Function).call({}, 'some-other-module', undefined)
        : undefined;
    // Should be undefined / falsy for unknown IDs.
    expect(resolved).toBeFalsy();
  });

  it('virtual module exports empty array when no useTween files are processed', () => {
    const output = buildVirtualModule([]);
    expect(output).toContain('export const usedEasings = []');
  });

  it('virtual module exports detected easing names after transform', () => {
    const code = `
      const t = useTween({ duration: 1, easing: 'easeOutQuad' });
    `;
    const output = buildVirtualModule([code]);
    expect(output).toContain('easeOutQuad');
    expect(output).toContain('export const usedEasings');
  });

  it('virtual module exports multiple unique easing names sorted', () => {
    const code1 = `useTween({ duration: 1, easing: 'spring' })`;
    const code2 = `useTween({ duration: 2, easing: 'linear' })`;
    const output = buildVirtualModule([code1, code2]) ?? '';
    // Both names must appear.
    expect(output).toContain('linear');
    expect(output).toContain('spring');
    // Sorted: linear before spring alphabetically.
    expect(output.indexOf('linear')).toBeLessThan(output.indexOf('spring'));
  });

  it('skips non-TS/JS files during transform', () => {
    const plugin = gwenTweenPlugin();
    if (typeof plugin.buildStart === 'function') {
      (plugin.buildStart as Function).call({});
    }
    // Pass a .css file — should be skipped entirely.
    let result: unknown;
    if (typeof plugin.transform === 'function') {
      result = (plugin.transform as Function).call({}, `easing: 'easeOutQuad'`, 'style.css');
    }
    expect(result).toBeUndefined();

    // Virtual module should still export empty array (nothing collected).
    const resolved = (plugin.resolveId as Function).call(
      {},
      'virtual:gwen/used-easings',
      undefined,
    );
    const output = (plugin.load as Function).call({}, resolved) as string;
    expect(output).toContain('export const usedEasings = []');
  });

  it('skips files that do not contain useTween or easing:', () => {
    const plugin = gwenTweenPlugin();
    if (typeof plugin.buildStart === 'function') {
      (plugin.buildStart as Function).call({});
    }
    let result: unknown;
    if (typeof plugin.transform === 'function') {
      result = (plugin.transform as Function).call(
        {},
        `const x = 42; // no useTween here`,
        'unrelated.ts',
      );
    }
    // Nothing returned (no transform needed).
    expect(result).toBeUndefined();
  });

  it('does nothing when disableEasingAnalysis is true', () => {
    const code = `useTween({ duration: 1, easing: 'easeOutQuad' })`;
    const output = buildVirtualModule([code], { tween: { disableEasingAnalysis: true } });
    // Should still return an empty array — no analysis was performed.
    expect(output).toContain('export const usedEasings = []');
  });

  it('resets collected easings on buildStart', () => {
    const plugin = gwenTweenPlugin();

    const runBuildStart = () => {
      if (typeof plugin.buildStart === 'function') {
        (plugin.buildStart as Function).call({});
      }
    };
    const runTransform = (code: string) => {
      if (typeof plugin.transform === 'function') {
        (plugin.transform as Function).call({}, code, 'file.ts');
      }
    };
    const loadVirtual = (): string => {
      const resolved = (plugin.resolveId as Function).call(
        {},
        'virtual:gwen/used-easings',
        undefined,
      );
      return (plugin.load as Function).call({}, resolved) as string;
    };

    // First build.
    runBuildStart();
    runTransform(`useTween({ duration: 1, easing: 'easeOutExpo' })`);
    const firstOutput = loadVirtual();
    expect(firstOutput).toContain('easeOutExpo');

    // Second build — buildStart should reset.
    runBuildStart();
    const secondOutput = loadVirtual();
    expect(secondOutput).toContain('export const usedEasings = []');
    expect(secondOutput).not.toContain('easeOutExpo');
  });
});
