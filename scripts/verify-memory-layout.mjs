#!/usr/bin/env node
/**
 * verify-memory-layout.mjs
 *
 * Verifies that the TypeScript memory-layout constants in shared-memory.ts match
 * the canonical values defined in the Rust source (transform.rs / bindings.rs).
 *
 * The Rust struct layout is:
 *   slot_offset +  0 : pos_x    (f32, 4 B)
 *   slot_offset +  4 : pos_y    (f32, 4 B)
 *   slot_offset +  8 : rotation (f32, 4 B)
 *   slot_offset + 12 : scale_x  (f32, 4 B)
 *   slot_offset + 16 : scale_y  (f32, 4 B)
 *   slot_offset + 20 : flags    (u32, 4 B)   ← FLAGS_OFFSET
 *   slot_offset + 24 : reserved (8  B)
 *   ─────────────────────────────────────────
 *                       32 B total            ← TRANSFORM_STRIDE
 *
 * 3D layout:
 *   pos_x/y/z (12 B) + rot_x/y/z/w (16 B) + scale_x/y/z (12 B) + flags (4 B) + pad (4 B)
 *   = 48 B total (TRANSFORM3D_STRIDE), flags at offset 40 (FLAGS3D_OFFSET)
 *
 * Run: node scripts/verify-memory-layout.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TS_FILE = join(__dirname, '../packages/@gwenjs/engine-core/src/wasm/shared-memory.ts');

/** Canonical values derived from the Rust struct layout (single source of truth). */
const EXPECTED = {
  TRANSFORM_STRIDE: 32,
  TRANSFORM3D_STRIDE: 48,
  FLAGS_OFFSET: 20,
  FLAGS3D_OFFSET: 40,
};

let src;
try {
  src = readFileSync(TS_FILE, 'utf8');
} catch (err) {
  console.error(`❌ Could not read ${TS_FILE}: ${err.message}`);
  process.exit(1);
}

let allOk = true;

for (const [name, expected] of Object.entries(EXPECTED)) {
  // Match: export const FOO = 32;  or  export const FOO = 32 as number;
  const match = src.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`));
  if (!match) {
    console.error(`❌ Constant '${name}' not found in ${TS_FILE}`);
    allOk = false;
    continue;
  }
  const actual = parseInt(match[1], 10);
  if (actual !== expected) {
    console.error(
      `❌ ${name}: TypeScript has ${actual}, Rust source of truth is ${expected}. ` +
        `Update shared-memory.ts to match the Rust struct layout.`,
    );
    allOk = false;
  } else {
    console.log(`✅ ${name} = ${actual}`);
  }
}

if (!allOk) {
  console.error('\nMemory layout mismatch — shared-memory.ts is out of sync with Rust structs.');
  process.exit(1);
}

console.log('\nAll memory layout constants match the Rust source of truth.');
