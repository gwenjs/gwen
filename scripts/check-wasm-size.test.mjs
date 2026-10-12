import assert from 'node:assert/strict';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import test from 'node:test';
import { allowedBudget, evaluateWasmSize } from './check-wasm-size.mjs';

const toolchain = { rust: '1.99.0', wasmPack: '0.13.1', wasmOpt: '133' };

/**
 * @param {number} baseline
 * @param {number} measured
 */
function pair(baseline, measured) {
  return { baseline, measured };
}

/**
 * @param {Record<string, { raw: number, gzip: { baseline: number, measured: number }, brotli: { baseline: number, measured: number } }>} sizesByVariant
 * @param {{ jsonChanged?: boolean, prBody?: string, observed?: typeof toolchain }} [opts]
 */
function run(sizesByVariant, opts = {}) {
  /** @type {Record<string, { path: string, raw: number, gzip: { baseline: number, budget: number }, brotli: { baseline: number, budget: number } }>} */
  const variants = {};
  /** @type {Record<string, { raw: number, gzip: number, brotli: number }>} */
  const measured = {};
  for (const [name, sizes] of Object.entries(sizesByVariant)) {
    variants[name] = {
      path: `pkg/${name}.wasm`,
      raw: sizes.raw,
      gzip: { baseline: sizes.gzip.baseline, budget: allowedBudget(sizes.gzip.baseline) },
      brotli: { baseline: sizes.brotli.baseline, budget: allowedBudget(sizes.brotli.baseline) },
    };
    measured[name] = {
      raw: sizes.raw,
      gzip: sizes.gzip.measured,
      brotli: sizes.brotli.measured,
    };
  }
  return evaluateWasmSize({
    catalog: {
      version: 1,
      toolchain,
      tolerance: 0.05,
      toleranceMinBytes: 2048,
      variants,
    },
    measured,
    observed: opts.observed ?? toolchain,
    jsonChanged: opts.jsonChanged ?? false,
    prBody: opts.prBody ?? '',
  });
}

test('+10% fails with the size line', () => {
  const baseline = 100_000;
  const result = run({
    light: {
      raw: 200_000,
      gzip: pair(baseline, 110_000),
      brotli: pair(baseline, baseline),
    },
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.lines.includes(
      '[WASM SIZE] light gzip: baseline 100000 → measured 110000 (budget 105000, +10.0%)',
    ),
  );
});

test('+4% passes', () => {
  const baseline = 100_000;
  const result = run({
    light: {
      raw: 200_000,
      gzip: pair(baseline, 104_000),
      brotli: pair(baseline, baseline),
    },
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.lines.some((line) => line.startsWith('[WASM SIZE] light')),
    false,
  );
});

test('−6% prints can be lowered and passes', () => {
  const baseline = 100_000;
  const result = run({
    light: {
      raw: 200_000,
      gzip: pair(baseline, 94_000),
      brotli: pair(baseline, baseline),
    },
  });
  assert.equal(result.ok, true);
  assert.ok(result.lines.some((line) => line.includes('can be lowered')));
});

test('a missing artifact fails and names the path', () => {
  const result = evaluateWasmSize({
    catalog: {
      version: 1,
      toolchain,
      tolerance: 0.05,
      toleranceMinBytes: 2048,
      variants: {
        light: {
          path: 'packages/core/wasm/light/gwen_core_bg.wasm',
          raw: 1,
          gzip: { baseline: 100_000, budget: allowedBudget(100_000) },
          brotli: { baseline: 100_000, budget: allowedBudget(100_000) },
        },
      },
    },
    files: {},
    observed: toolchain,
    jsonChanged: false,
    prBody: '',
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.lines.includes(
      '[WASM SIZE] light: artifact missing at packages/core/wasm/light/gwen_core_bg.wasm',
    ),
  );
});

test('a toolchain mismatch fails with re-record', () => {
  const baseline = 100_000;
  const result = run(
    {
      light: {
        raw: 200_000,
        gzip: pair(baseline, baseline),
        brotli: pair(baseline, baseline),
      },
    },
    { observed: { ...toolchain, wasmOpt: '132' } },
  );
  assert.equal(result.ok, false);
  assert.ok(result.lines.some((line) => line.includes('re-record') && line.includes('132')));
});

test('changed json without the PR section fails', () => {
  const baseline = 100_000;
  const result = run(
    {
      light: {
        raw: 200_000,
        gzip: pair(baseline, baseline),
        brotli: pair(baseline, baseline),
      },
    },
    { jsonChanged: true, prBody: '## Summary\nno budget here\n' },
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.lines.includes(
      '[WASM SIZE] wasm-size.json changed without a "WASM size budget" section in the PR body',
    ),
  );
});

test('the section heading lets a changed json pass', () => {
  const baseline = 100_000;
  const result = run(
    {
      light: {
        raw: 200_000,
        gzip: pair(baseline, baseline),
        brotli: pair(baseline, baseline),
      },
    },
    { jsonChanged: true, prBody: '## WASM size budget\nrecorded\n' },
  );
  assert.equal(result.ok, true);
});

test('gzip level 9 and brotli quality 11 are the measured bytes', () => {
  const bytes = Buffer.from('gwen-wasm-size-check'.repeat(50));
  const gzip = gzipSync(bytes, { level: 9 }).length;
  const brotli = brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  const result = evaluateWasmSize({
    catalog: {
      version: 1,
      toolchain,
      tolerance: 0.05,
      toleranceMinBytes: 2048,
      variants: {
        light: {
          path: 'light.wasm',
          raw: bytes.length,
          gzip: { baseline: gzip, budget: allowedBudget(gzip) },
          brotli: { baseline: brotli, budget: allowedBudget(brotli) },
        },
      },
    },
    files: { 'light.wasm': bytes },
    observed: toolchain,
    jsonChanged: false,
    prBody: '',
  });
  assert.equal(result.ok, true);
  assert.match(result.table, new RegExp(`light \\| ${bytes.length} \\|`));
});

test('baseline 0 over the minimum budget fails with +n/a%', () => {
  const result = run({
    light: {
      raw: 10,
      gzip: pair(0, 3_000),
      brotli: pair(0, 0),
    },
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.lines.includes(
      '[WASM SIZE] light gzip: baseline 0 → measured 3000 (budget 2048, +n/a%)',
    ),
  );
});

test('a stored budget that is not the formula fails', () => {
  const result = evaluateWasmSize({
    catalog: {
      version: 1,
      toolchain,
      tolerance: 0.05,
      toleranceMinBytes: 2048,
      variants: {
        light: {
          path: 'pkg/light.wasm',
          raw: 1,
          gzip: { baseline: 100_000, budget: allowedBudget(100_000) + 1 },
          brotli: { baseline: 100_000, budget: allowedBudget(100_000) },
        },
      },
    },
    measured: { light: { raw: 1, gzip: 100_000, brotli: 100_000 } },
    observed: toolchain,
    jsonChanged: false,
    prBody: '',
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.lines.includes('[WASM SIZE] light gzip: stored budget 105001 != formula 105000'),
  );
});
