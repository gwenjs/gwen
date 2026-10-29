import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { defineGwenModule, type GwenModule } from "@gwenjs/kit/module";
import { GwenError } from "@gwenjs/schema";
import { GwenApp } from "../src/app.js";
import { resolveLoadedConfig } from "../src/config.js";

const see = (code: string): string =>
  `See https://gwenjs.github.io/gwen/api/errors#${code.toLowerCase().replace(/[:_]/g, "-")} (${code})`;

function moduleOf(name: string, setup: () => void): Promise<GwenModule> {
  return Promise.resolve(defineGwenModule({ meta: { name }, setup }));
}

function fail(error: Error): never {
  throw error;
}

async function thrown(
  name: string,
  loader?: (moduleName: string) => Promise<GwenModule>,
): Promise<GwenError> {
  const caught: unknown = await new GwenApp()
    .setupModules(resolveLoadedConfig({ modules: [name] }), loader)
    .catch((err: unknown) => err);
  expect(caught).toBeInstanceOf(GwenError);
  if (!(caught instanceof GwenError)) throw new Error("expected GwenError");
  return caught;
}

it.each([
  ["loader rejection keeps the install hint", "@test/missing", "APP:MODULE_LOAD_FAILED", false],
  ["setup rejection", "@test/blows", "APP:MODULE_SETUP_FAILED", true],
] as const)("%s", async (_label, name, code, blown) => {
  const cause = new Error(blown ? "setup blew up" : "Cannot find package '@test/missing'");
  const loader = (): Promise<GwenModule> =>
    blown ? moduleOf(name, () => fail(cause)) : Promise.reject(cause);
  const caught = await thrown(name, loader);
  const msg = caught.message.split("\n");
  const head = blown
    ? `[GWEN] Module "${name}" setup() threw: ${cause.message}.`
    : `[GWEN] Failed to load module "${name}": ${cause.message}. Hint: run 'gwen add ${name}' to install it.`;
  expect([msg[0], msg.at(-1), caught.code, caught.cause]).toEqual([head, see(code), code, cause]);
});

it("missing package renders one [GWEN], a Fix line, and one See line", async () => {
  const name = "@gwenjs/not-a-real-package-p64";
  const caught = await thrown(name);
  const err = caught.cause;
  expect(err).toBeInstanceOf(Error);
  if (!(err instanceof Error)) return;
  const detail = /[.?!]$/.test(err.message) ? err.message : `${err.message}.`;
  const fix = __GWEN_DEV__ ? `\nFix: run 'gwen add ${name}' to install it.` : "";
  expect(caught.message).toBe(
    `[GWEN] Failed to load module "${name}". Check that the package is installed and the name is spelled correctly. Cause: ${detail}${fix}\n${see("APP:MODULE_LOAD_FAILED")}`,
  );
});
it("evaluated module throw has no install Fix line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-p64-"));
  try {
    const name = join(dir, "blow.mjs");
    writeFileSync(name, "throw new Error('eval blew');\n");
    const caught = await thrown(name);
    const cause = caught.cause;
    expect(cause instanceof Error ? cause.message : "").toBe("eval blew");
    expect(caught.message).toBe(
      `[GWEN] Failed to load module "${name}". Check that the package is installed and the name is spelled correctly. Cause: eval blew.\n${see("APP:MODULE_LOAD_FAILED")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("a GwenError from setup() keeps one [GWEN], one See line, and the cause", async () => {
  const name = "@test/grammar-cause";
  const inner = new GwenError("SCHEMA:INVALID_CONFIG", "plugins must be an array.", {});
  const caught = await thrown(name, () => moduleOf(name, () => fail(inner)));
  expect(caught.message).toBe(
    `[GWEN] Module "${name}" setup() threw: plugins must be an array.\n${see("APP:MODULE_SETUP_FAILED")}`,
  );
  expect([caught.cause, caught.code]).toEqual([inner, "APP:MODULE_SETUP_FAILED"]);
});

it("an invalid module export throws KIT:MODULE_INVALID without a tag", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-p648-"));
  try {
    const name = join(dir, "no-setup.mjs");
    writeFileSync(name, "export default { meta: { name: 'no-setup' } };\n");
    const caught = await thrown(name);
    expect(caught.code).toBe("APP:MODULE_LOAD_FAILED");
    const cause = caught.cause;
    expect(cause).toBeInstanceOf(GwenError);
    if (!(cause instanceof GwenError)) return;
    const fix = __GWEN_DEV__
      ? "\nFix: Ensure the module exports a default object created with defineGwenModule()."
      : "";
    expect(cause.code).toBe("KIT:MODULE_INVALID");
    expect(cause.message).toBe(
      `[GWEN] Module "${name}" does not export a valid GwenModule (missing setup function).${fix}\n${see("KIT:MODULE_INVALID")}`,
    );
    expect(cause.message.includes("[GWEN] [GWEN]")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
