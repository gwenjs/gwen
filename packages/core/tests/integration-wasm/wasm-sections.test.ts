import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const VARIANTS = ["light", "physics2d", "physics3d"] as const;
type Variant = (typeof VARIANTS)[number];

function wasmBytes(variant: Variant): Uint8Array<ArrayBuffer> {
  const wasmPath = fileURLToPath(
    new URL(`../../wasm/${variant}/gwen_core_bg.wasm`, import.meta.url),
  );
  const file = readFileSync(wasmPath);
  const bytes = new Uint8Array(file.byteLength);
  bytes.set(file);
  return bytes;
}

function sectionText(module: WebAssembly.Module, name: string): string[] {
  return WebAssembly.Module.customSections(module, name).map((section) =>
    new TextDecoder().decode(section),
  );
}

async function loadFactory(variant: Variant): Promise<unknown> {
  const spec = `@gwenjs/core/wasm/${variant}/factory`;
  try {
    return await import(/* @vite-ignore */ spec);
  } catch (error: unknown) {
    return error;
  }
}

function contractField(loaded: unknown, field: string): unknown {
  if (typeof loaded !== "object" || loaded === null || !("CONTRACT" in loaded)) return undefined;
  const contract = loaded.CONTRACT;
  if (typeof contract !== "object" || contract === null) return undefined;
  return Reflect.get(contract, field);
}

it.each(VARIANTS)(
  "%s binary carries one gwen.build and one gwen.fingerprint section",
  (variant) => {
    const module = new WebAssembly.Module(wasmBytes(variant));
    const build = sectionText(module, "gwen.build");
    const fingerprint = sectionText(module, "gwen.fingerprint");
    expect(build).toHaveLength(1);
    expect(fingerprint).toHaveLength(1);
    expect(build[0]).toMatch(/^[0-9a-f]{64}$/);
  },
);

it.each(VARIANTS)("%s factory CONTRACT.buildId equals the binary's gwen.build", async (variant) => {
  const module = new WebAssembly.Module(wasmBytes(variant));
  const build = sectionText(module, "gwen.build");
  expect(build).toHaveLength(1);
  expect(contractField(await loadFactory(variant), "buildId")).toBe(build[0]);
});

it.each(VARIANTS)("%s fingerprint names its variant and the ABI number", async (variant) => {
  const module = new WebAssembly.Module(wasmBytes(variant));
  const fingerprint = sectionText(module, "gwen.fingerprint");
  expect(fingerprint).toHaveLength(1);
  const fromBinary = fingerprint[0] ?? "";
  const prefix = `gwen-core;variant=${variant};abi=`;
  expect(contractField(await loadFactory(variant), "fingerprint")).toBe(fromBinary);
  expect(fromBinary.startsWith(prefix)).toBe(true);
  expect(/^\d+/.test(fromBinary.slice(prefix.length))).toBe(true);
});
