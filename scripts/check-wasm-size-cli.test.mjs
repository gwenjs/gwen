import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { allowedBudget, evaluateWasmSize } from './check-wasm-size.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const toolchain = { rust: '1.99.0', wasmPack: '0.13.1', wasmOpt: '133' };
const sectionLine =
  '[WASM SIZE] wasm-size.json changed without a "WASM size budget" section in the PR body';

/**
 * @param {number} n
 * @returns {Buffer}
 */
function noisy(n) {
  const buf = Buffer.alloc(n);
  let x = 0x12345678;
  for (let i = 0; i < n; i += 1) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    buf[i] = (x >>> 16) & 0xff;
  }
  return buf;
}

/**
 * @param {Buffer} buf
 * @returns {{ raw: number, gzip: number, brotli: number }}
 */
function measure(buf) {
  return {
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

/**
 * @param {number} gzipBaseline
 * @param {number} brotliBaseline
 * @param {{ tolerance?: number, toleranceMinBytes?: number, gzipBudget?: number, brotliBudget?: number }} [opts]
 */
function catalog(gzipBaseline, brotliBaseline, opts = {}) {
  const tolerance = opts.tolerance ?? 0.05;
  const minBytes = opts.toleranceMinBytes ?? 2048;
  const budget = (baseline) => baseline + Math.max(Math.ceil(baseline * tolerance), minBytes);
  return {
    version: 1,
    toolchain,
    tolerance,
    toleranceMinBytes: minBytes,
    variants: {
      light: {
        path: 'packages/core/wasm/light/gwen_core_bg.wasm',
        raw: 1,
        gzip: { baseline: gzipBaseline, budget: opts.gzipBudget ?? budget(gzipBaseline) },
        brotli: { baseline: brotliBaseline, budget: opts.brotliBudget ?? budget(brotliBaseline) },
      },
    },
  };
}

/**
 * @param {string} root
 * @param {string[]} args
 */
function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

/**
 * @param {ReturnType<typeof catalog>} body
 */
function initRepo(body) {
  const root = mkdtempSync(path.join(tmpdir(), 'gwen-wasm-size-'));
  mkdirSync(path.join(root, 'scripts'));
  cpSync(
    path.join(repoRoot, 'scripts/check-wasm-size.mjs'),
    path.join(root, 'scripts/check-wasm-size.mjs'),
  );
  writeFileSync(path.join(root, 'wasm-size.json'), `${JSON.stringify(body, null, 2)}\n`);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'size-test@example.com']);
  git(root, ['config', 'user.name', 'size-test']);
  git(root, ['add', 'wasm-size.json', 'scripts/check-wasm-size.mjs']);
  git(root, ['commit', '-q', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);
  return { root, base };
}

/**
 * @param {string} root
 * @param {ReturnType<typeof catalog>} body
 * @param {Buffer} wasm
 */
function commitCatalog(root, body, wasm) {
  writeFileSync(path.join(root, 'wasm-size.json'), `${JSON.stringify(body, null, 2)}\n`);
  const wasmPath = path.join(root, 'packages/core/wasm/light/gwen_core_bg.wasm');
  mkdirSync(path.dirname(wasmPath), { recursive: true });
  writeFileSync(wasmPath, wasm);
  const stampPath = path.join(root, 'packages/core/wasm/toolchain.json');
  writeFileSync(stampPath, `${JSON.stringify(toolchain, null, 2)}\n`);
  git(root, ['add', 'wasm-size.json']);
  git(root, ['commit', '-q', '-m', 'change']);
}

/**
 * @param {string} root
 * @param {string} base
 * @param {NodeJS.ProcessEnv} env
 */
function runCli(root, base, env) {
  return spawnSync(process.execPath, ['scripts/check-wasm-size.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SIZE_BASE: base, GWEN_PR_BODY: '', PR_NUMBER: '', ...env },
  });
}

/**
 * @param {string} name
 * @param {string} text
 * @param {string} bin
 */
function stub(bin, name, text) {
  const file = path.join(bin, name);
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}

test('cli: json changed without the section exits 1', () => {
  const wasm = Buffer.from('gwen-wasm-size-check'.repeat(50));
  const size = measure(wasm);
  const { root, base } = initRepo(catalog(size.gzip, size.brotli));
  try {
    const changed = catalog(size.gzip, size.brotli);
    changed.variants.light.raw = 2;
    commitCatalog(root, changed, wasm);
    const result = runCli(root, base, {});
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(sectionLine));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cli: the section exits 0', () => {
  const wasm = Buffer.from('gwen-wasm-size-check'.repeat(50));
  const size = measure(wasm);
  const { root, base } = initRepo(catalog(size.gzip, size.brotli));
  try {
    const changed = catalog(size.gzip, size.brotli);
    changed.variants.light.raw = 2;
    commitCatalog(root, changed, wasm);
    const result = runCli(root, base, { GWEN_PR_BODY: '## WASM size budget\nrecorded\n' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes(sectionLine), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cli: an h3 heading still exits 1', () => {
  const wasm = Buffer.from('gwen-wasm-size-check'.repeat(50));
  const size = measure(wasm);
  const { root, base } = initRepo(catalog(size.gzip, size.brotli));
  try {
    const changed = catalog(size.gzip, size.brotli);
    changed.variants.light.raw = 2;
    commitCatalog(root, changed, wasm);
    const result = runCli(root, base, { GWEN_PR_BODY: '### WASM size budget\nrecorded\n' });
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(sectionLine));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cli: a prose mention still exits 1', () => {
  const wasm = Buffer.from('gwen-wasm-size-check'.repeat(50));
  const size = measure(wasm);
  const { root, base } = initRepo(catalog(size.gzip, size.brotli));
  try {
    const changed = catalog(size.gzip, size.brotli);
    changed.variants.light.raw = 2;
    commitCatalog(root, changed, wasm);
    const result = runCli(root, base, {
      GWEN_PR_BODY: 'The WASM size budget is described in the discussion.\n',
    });
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(sectionLine));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cli: a fenced heading still exits 1', () => {
  const wasm = Buffer.from('gwen-wasm-size-check'.repeat(50));
  const size = measure(wasm);
  const { root, base } = initRepo(catalog(size.gzip, size.brotli));
  try {
    const changed = catalog(size.gzip, size.brotli);
    changed.variants.light.raw = 2;
    commitCatalog(root, changed, wasm);
    const result = runCli(root, base, {
      GWEN_PR_BODY: 'Example:\n```\n## WASM size budget\nrecorded\n```\n',
    });
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(sectionLine));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cli: an empty SIZE_BASE does not require the section', () => {
  const wasm = Buffer.from('gwen-wasm-size-check'.repeat(50));
  const size = measure(wasm);
  const { root, base } = initRepo(catalog(size.gzip, size.brotli));
  try {
    const changed = catalog(size.gzip, size.brotli);
    changed.variants.light.raw = 2;
    commitCatalog(root, changed, wasm);
    const result = runCli(root, base, { SIZE_BASE: '' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('[WASM SIZE]'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cli: over budget exits 1', () => {
  const wasm = noisy(8000);
  const size = measure(wasm);
  assert.ok(size.gzip > 2048);
  const { root, base } = initRepo(catalog(0, 0));
  try {
    const changed = catalog(0, 0);
    changed.variants.light.raw = 2;
    commitCatalog(root, changed, wasm);
    const result = runCli(root, base, { GWEN_PR_BODY: '## WASM size budget\nrecorded\n' });
    assert.equal(result.status, 1);
    assert.ok(
      result.stdout.includes(
        `[WASM SIZE] light gzip: baseline 0 → measured ${size.gzip} (budget 2048, +n/a%)`,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('brotli +10% fails with the exact line', () => {
  const result = evaluateWasmSize({
    catalog: catalog(100_000, 100_000),
    measured: { light: { raw: 1, gzip: 100_000, brotli: 110_000 } },
    observed: toolchain,
    jsonChanged: false,
    prBody: '',
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.lines.includes(
      '[WASM SIZE] light brotli: baseline 100000 → measured 110000 (budget 105000, +10.0%)',
    ),
  );
});

test('gzip within budget and brotli over budget fails', () => {
  const result = evaluateWasmSize({
    catalog: catalog(100_000, 100_000),
    measured: { light: { raw: 1, gzip: 104_000, brotli: 110_000 } },
    observed: toolchain,
    jsonChanged: false,
    prBody: '',
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.lines.some((line) => line.startsWith('[WASM SIZE] light gzip:')),
    false,
  );
  assert.ok(
    result.lines.includes(
      '[WASM SIZE] light brotli: baseline 100000 → measured 110000 (budget 105000, +10.0%)',
    ),
  );
});

test('tolerance 0.5 with recomputed budgets fails', () => {
  const wide = (baseline) => baseline + Math.max(Math.ceil(baseline * 0.5), 2048);
  const result = evaluateWasmSize({
    catalog: catalog(100_000, 100_000, {
      tolerance: 0.5,
      gzipBudget: wide(100_000),
      brotliBudget: wide(100_000),
    }),
    measured: { light: { raw: 1, gzip: 100_000, brotli: 100_000 } },
    observed: toolchain,
    jsonChanged: false,
    prBody: '## WASM size budget\nwidened\n',
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.lines.includes(
      '[WASM SIZE] tolerance 0.5 != 0.05; toleranceMinBytes 2048 != 2048',
    ),
  );
  assert.ok(
    result.lines.includes('[WASM SIZE] light gzip: stored budget 150000 != formula 105000'),
  );
  assert.ok(
    result.lines.includes('[WASM SIZE] light brotli: stored budget 150000 != formula 105000'),
  );
});

test('toleranceMinBytes 0 with recomputed budgets fails', () => {
  const baseline = 10_000;
  const withoutFloor = baseline + Math.ceil(baseline * 0.05);
  const result = evaluateWasmSize({
    catalog: catalog(baseline, baseline, {
      toleranceMinBytes: 0,
      gzipBudget: withoutFloor,
      brotliBudget: withoutFloor,
    }),
    measured: { light: { raw: 1, gzip: baseline, brotli: baseline } },
    observed: toolchain,
    jsonChanged: false,
    prBody: '## WASM size budget\nfloor removed\n',
  });
  assert.equal(withoutFloor, 10_500);
  assert.equal(result.ok, false);
  assert.ok(
    result.lines.includes(
      '[WASM SIZE] tolerance 0.05 != 0.05; toleranceMinBytes 0 != 2048',
    ),
  );
  assert.ok(
    result.lines.includes('[WASM SIZE] light gzip: stored budget 10500 != formula 12048'),
  );
  assert.ok(
    result.lines.includes('[WASM SIZE] light brotli: stored budget 10500 != formula 12048'),
  );
});

test('cli: a higher baseline without a filled section exits 1', () => {
  const wasm = Buffer.from('gwen-wasm-size-check'.repeat(50));
  const size = measure(wasm);
  const { root, base } = initRepo(catalog(1000, size.brotli));
  try {
    commitCatalog(root, catalog(5000, size.brotli), wasm);
    const result = runCli(root, base, {});
    assert.equal(result.status, 1);
    assert.ok(
      result.stdout.includes(
        '[WASM SIZE] light gzip: baseline raised from 1000 to 5000 without a non-empty "## WASM size budget" section',
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cli: a higher baseline with a filled section exits 0', () => {
  const wasm = Buffer.from('gwen-wasm-size-check'.repeat(50));
  const size = measure(wasm);
  const { root, base } = initRepo(catalog(1000, 1000));
  try {
    commitCatalog(root, catalog(5000, 5000), wasm);
    const result = runCli(root, base, { GWEN_PR_BODY: '## WASM size budget\nrecorded from CI\n' });
    assert.equal(result.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cli: a higher brotli baseline without a filled section exits 1', () => {
  const wasm = Buffer.from('gwen-wasm-size-check'.repeat(50));
  const size = measure(wasm);
  const { root, base } = initRepo(catalog(size.gzip, 1000));
  try {
    commitCatalog(root, catalog(size.gzip, 5000), wasm);
    const result = runCli(root, base, {});
    assert.equal(result.status, 1);
    assert.ok(
      result.stdout.includes(
        '[WASM SIZE] light brotli: baseline raised from 1000 to 5000 without a non-empty "## WASM size budget" section',
      ),
    );
    assert.equal(result.stdout.includes('light gzip: baseline raised'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cli: a heading with no body still rejects a higher baseline', () => {
  const wasm = Buffer.from('gwen-wasm-size-check'.repeat(50));
  const size = measure(wasm);
  const { root, base } = initRepo(catalog(1000, 1000));
  try {
    commitCatalog(root, catalog(5000, 5000), wasm);
    const result = runCli(root, base, { GWEN_PR_BODY: '## WASM size budget\n\n' });
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes('baseline raised from 1000'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('measured equal to the budget passes and one byte over fails', () => {
  const baseline = 100_000;
  const budget = allowedBudget(baseline);
  const atBudget = evaluateWasmSize({
    catalog: catalog(baseline, baseline),
    measured: { light: { raw: 1, gzip: budget, brotli: baseline } },
    observed: toolchain,
    jsonChanged: false,
    prBody: '',
  });
  assert.equal(atBudget.ok, true);
  const over = evaluateWasmSize({
    catalog: catalog(baseline, baseline),
    measured: { light: { raw: 1, gzip: budget + 1, brotli: baseline } },
    observed: toolchain,
    jsonChanged: false,
    prBody: '',
  });
  assert.equal(over.ok, false);
  assert.ok(
    over.lines.includes(
      `[WASM SIZE] light gzip: baseline 100000 → measured ${budget + 1} (budget ${budget}, +5.0%)`,
    ),
  );
});

test('a baseline that is not a multiple of 20 uses ceil', () => {
  const baseline = 100_001;
  const budget = baseline + Math.ceil(baseline * 0.05);
  const result = evaluateWasmSize({
    catalog: catalog(baseline, baseline),
    measured: { light: { raw: 1, gzip: budget, brotli: baseline } },
    observed: toolchain,
    jsonChanged: false,
    prBody: '',
  });
  assert.equal(budget, 105_002);
  assert.equal(result.ok, true);
  assert.match(result.table, /105002 \/ /);
});

test('the 2048 floor keeps fracture-sized gzip inside the budget', () => {
  const baseline = 11_255;
  const result = evaluateWasmSize({
    catalog: catalog(baseline, baseline),
    measured: { light: { raw: 23_084, gzip: 12_000, brotli: baseline } },
    observed: toolchain,
    jsonChanged: false,
    prBody: '',
  });
  assert.equal(allowedBudget(baseline), 13_303);
  assert.equal(result.ok, true);
  assert.match(result.table, /13303 \/ /);
});

test('an h3, prose, and a fence are not the budget section', () => {
  const measured = { light: { raw: 1, gzip: 100_000, brotli: 100_000 } };
  const bodies = [
    '### WASM size budget\nrecorded\n',
    'See the WASM size budget notes.\n',
    '```\n## WASM size budget\nrecorded\n```\n',
  ];
  for (const prBody of bodies) {
    const result = evaluateWasmSize({
      catalog: catalog(100_000, 100_000),
      measured,
      observed: toolchain,
      jsonChanged: true,
      prBody,
    });
    assert.equal(result.ok, false);
    assert.ok(result.lines.includes(sectionLine));
  }
});

test('a failure wins over can be lowered', () => {
  const result = evaluateWasmSize({
    catalog: catalog(100_000, 100_000),
    measured: { light: { raw: 1, gzip: 110_000, brotli: 94_000 } },
    observed: toolchain,
    jsonChanged: false,
    prBody: '',
  });
  assert.equal(result.ok, false);
  assert.match(result.table, /\| over \|/);
  assert.ok(result.lines.some((line) => line.includes('→ measured')));
  assert.ok(result.lines.some((line) => line.includes('can be lowered')));
  assert.equal(result.table.includes('can be lowered'), false);
});

test('the step summary table has a markdown separator', () => {
  const result = evaluateWasmSize({
    catalog: catalog(100_000, 100_000),
    measured: { light: { raw: 1, gzip: 100_000, brotli: 100_000 } },
    observed: toolchain,
    jsonChanged: false,
    prBody: '',
  });
  assert.ok(result.table.includes('| --- | --- | --- | --- | --- | --- |'));
});

test('rust and wasmPack mismatches fail with re-record', () => {
  const base = {
    catalog: catalog(100_000, 100_000),
    measured: { light: { raw: 1, gzip: 100_000, brotli: 100_000 } },
    jsonChanged: false,
    prBody: '',
  };
  const rust = evaluateWasmSize({
    ...base,
    observed: { ...toolchain, rust: '1.90.0' },
  });
  assert.equal(rust.ok, false);
  assert.ok(rust.lines.some((line) => line.includes('toolchain rust') && line.includes('1.90.0') && line.includes('re-record')));
  const pack = evaluateWasmSize({
    ...base,
    observed: { ...toolchain, wasmPack: '0.14.0' },
  });
  assert.equal(pack.ok, false);
  assert.ok(pack.lines.some((line) => line.includes('toolchain wasmPack') && line.includes('0.14.0') && line.includes('re-record')));
});

test('the three rust version sources agree', () => {
  const pinned = JSON.parse(readFileSync(path.join(repoRoot, 'wasm-size.json'), 'utf8')).toolchain.rust;
  const toml = readFileSync(path.join(repoRoot, 'rust-toolchain.toml'), 'utf8');
  const channel = toml.match(/channel = "([^"]+)"/);
  assert.equal(channel?.[1], pinned);
  const ci = readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const pins = [...ci.matchAll(/toolchain: "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(pins.length >= 5);
  for (const pin of pins) assert.equal(pin, pinned);
});

test('contributor docs name the pinned wasm tools', () => {
  const files = [
    'internals-docs/contributing.md',
    'README.md',
    'internals-docs/crate-builds.md',
  ];
  for (const file of files) {
    const text = readFileSync(path.join(repoRoot, file), 'utf8');
    assert.ok(text.includes('1.99.0'), file);
    assert.ok(text.includes('0.13.1'), file);
    assert.ok(text.includes('wasm-opt'), file);
    assert.ok(text.includes('133'), file);
    assert.ok(text.includes('GWEN_SKIP_WASM_OPT'), file);
  }
});

test('binaryen archives are pinned by sha256 and the workflow checks them', () => {
  const json = JSON.parse(readFileSync(path.join(repoRoot, 'wasm-size.json'), 'utf8'));
  assert.equal(typeof json.binaryen, 'object');
  assert.equal(
    json.binaryen['linux-x86_64'].sha256,
    '2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489',
  );
  assert.equal(
    json.binaryen['macos-arm64'].sha256,
    'ad66da82ac13f163e424b1643f16c6dfcccc98b5966296b43e52d3cab04f84a8',
  );
  assert.equal(
    json.binaryen['macos-x86_64'].sha256,
    '13a9b90be775c6389ce3d1f879cb8627bea56708ba8c122983941d53a8199b95',
  );
  const ci = readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  assert.ok(ci.includes('sha256sum -c'));
  assert.equal(ci.includes('sudo tar -xzf /tmp/binaryen.tar.gz -C /usr/local'), false);
  assert.match(ci, /wasm-size:[\s\S]*timeout-minutes: 2/);
  assert.match(
    ci,
    /echo "\$dest\/bin" >> "\$GITHUB_PATH"\n {10}export PATH="\$dest\/bin:\$PATH"\n {10}wasm-opt --version/,
  );
});

test('the toolchain stamp is not in the core package', () => {
  const core = path.join(repoRoot, 'packages/core');
  const stamp = path.join(core, 'wasm/toolchain.json');
  mkdirSync(path.dirname(stamp), { recursive: true });
  const previous = (() => {
    try {
      return readFileSync(stamp);
    } catch {
      return null;
    }
  })();
  writeFileSync(stamp, '{"rust":"1.99.0","wasmPack":"0.13.1","wasmOpt":"133"}\n');
  try {
    const result = spawnSync('pnpm', ['pack', '--dry-run', '--pack-destination', tmpdir()], {
      cwd: core,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const listing = `${result.stdout}\n${result.stderr}`;
    assert.equal(listing.includes('toolchain.json'), false);
  } finally {
    if (previous) writeFileSync(stamp, previous);
    else rmSync(stamp, { force: true });
  }
});

/**
 * @param {string | null} wasmOptText
 * @param {NodeJS.ProcessEnv} env
 */
function runBuildProbe(wasmOptText, env) {
  const root = mkdtempSync(path.join(tmpdir(), 'gwen-wasm-build-'));
  mkdirSync(path.join(root, 'scripts'));
  cpSync(path.join(repoRoot, 'scripts/build-wasm.sh'), path.join(root, 'scripts/build-wasm.sh'));
  writeFileSync(
    path.join(root, 'wasm-size.json'),
    `${JSON.stringify({ toolchain: { rust: '1.99.0', wasmPack: '0.13.1', wasmOpt: '133' } })}\n`,
  );
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  stub(bin, 'rustc', '#!/bin/sh\necho "rustc 1.99.0 (stub)"\n');
  stub(bin, 'wasm-pack', '#!/bin/sh\necho "wasm-pack 0.13.1"\n');
  if (wasmOptText !== null) {
    stub(bin, 'wasm-opt', `#!/bin/sh\necho "${wasmOptText}"\n`);
  }
  const result = spawnSync('bash', ['scripts/build-wasm.sh'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, CI: '', ...env },
  });
  return { root, result };
}

test('a missing wasm-opt names the archives and the skip hatch', () => {
  const { root, result } = runBuildProbe(null, {});
  try {
    assert.equal(result.status, 1);
    const text = `${result.stdout}\n${result.stderr}`;
    assert.ok(text.includes('binaryen-version_133-arm64-macos.tar.gz'));
    assert.ok(text.includes('binaryen-version_133-x86_64-macos.tar.gz'));
    assert.ok(text.includes('binaryen-version_133-x86_64-linux.tar.gz'));
    assert.ok(text.includes('shasum -a 256 -c'));
    assert.ok(text.includes('sha256sum -c'));
    assert.ok(text.includes('GWEN_SKIP_WASM_OPT=1'));
    assert.ok(text.includes('CI=true'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an official wasm-opt 133 is accepted', () => {
  const { root, result } = runBuildProbe('wasm-opt version 133 (version_133)', {
    GWEN_WASM_OPT_CHECK_ONLY: '1',
  });
  try {
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a wasm-opt 132 is refused', () => {
  const { root, result } = runBuildProbe('wasm-opt version 132 (version_132)', {
    GWEN_WASM_OPT_CHECK_ONLY: '1',
  });
  try {
    assert.equal(result.status, 1);
    assert.ok(`${result.stdout}\n${result.stderr}`.includes('not pinned 133'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a wasm-opt parenthetical that disagrees is refused', () => {
  const { root, result } = runBuildProbe('wasm-opt version 133 (version_132)', {
    GWEN_WASM_OPT_CHECK_ONLY: '1',
  });
  try {
    assert.equal(result.status, 1);
    assert.ok(`${result.stdout}\n${result.stderr}`.includes('not pinned 133'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a homebrew wasm-opt 133 is accepted', () => {
  const { root, result } = runBuildProbe('wasm-opt version 133', { GWEN_WASM_OPT_CHECK_ONLY: '1' });
  try {
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the stamp records the wasm-opt version it parsed', () => {
  const { root, result } = runBuildProbe('wasm-opt version 132 (version_132)', {
    GWEN_WRITE_STAMP_ONLY: '1',
  });
  try {
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const stamp = JSON.parse(
      readFileSync(path.join(root, 'packages/core/wasm/toolchain.json'), 'utf8'),
    );
    assert.equal(stamp.wasmOpt, '132');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
