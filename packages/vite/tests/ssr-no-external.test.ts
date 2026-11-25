/**
 * `ssr.noExternal` covering `@gwenjs/core`: the plugin warns at config time (the build still
 * succeeds). Hermetic: a real `resolveConfig` of a temp root, no build, no WASM artifact.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, resolveConfig, type InlineConfig } from "vite";
import { describe, expect, it } from "vitest";
import { gwen } from "../src/index.js";

type SsrOptions = NonNullable<InlineConfig["ssr"]>;

interface ResolveOptions {
  /** Value of `build.ssr`. */
  buildSsr: boolean;
  /** Fields of the top-level `ssr` option; absent keeps Vite's default. */
  ssr?: SsrOptions;
}

/** Resolve a build config of a throwaway root and return the warnings the logger received. */
async function warningsOf(options: ResolveOptions, rounds = 1): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "gwen-ssr-noexternal-"));
  const warnings: string[] = [];
  const logger = createLogger("warn");
  logger.warn = (message) => {
    warnings.push(message);
  };
  try {
    writeFileSync(join(root, "gwen.config.ts"), "export default { modules: [] };\n");
    for (let round = 0; round < rounds; round++) {
      const resolved = await resolveConfig(
        {
          root,
          configFile: false,
          plugins: gwen(),
          customLogger: logger,
          build: { ssr: options.buildSsr },
          ...(options.ssr === undefined ? {} : { ssr: options.ssr }),
        },
        "build",
      );
      // The warning never fails the resolve: the config is complete.
      if (Boolean(resolved.build.ssr) !== options.buildSsr) throw new Error("build.ssr was lost");
    }
    return warnings;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const coveringForms: ReadonlyArray<readonly [string, NonNullable<SsrOptions["noExternal"]>]> = [
  ["the string @gwenjs/core", "@gwenjs/core"],
  ["a RegExp matching @gwenjs/core", /^@gwenjs\/core$/],
  ["an array holding a matching RegExp", ["other-pkg", /@gwenjs\/co/]],
  ["true", true],
];

describe("ssr noExternal warning", () => {
  it.each(coveringForms)("warns once when ssr.noExternal is %s", async (_label, noExternal) => {
    const warnings = await warningsOf({ buildSsr: true, ssr: { noExternal } });
    expect(warnings).toHaveLength(1);
    const [warning] = warnings;
    expect(warning).toContain("ssr.noExternal");
    expect(warning).toContain("@gwenjs/core");
    expect(warning).toContain("CORE:WASM_LOAD_ERROR");
  });

  it("warns only for an ssr build whose noExternal covers @gwenjs/core", async () => {
    // Positive control: the covering config warns, so the zero counts below mean something.
    expect(
      await warningsOf({ buildSsr: true, ssr: { noExternal: ["@gwenjs/core"] } }),
    ).toHaveLength(1);
    const quiet: ReadonlyArray<readonly [string, ResolveOptions]> = [
      ["not an ssr build", { buildSsr: false, ssr: { noExternal: ["@gwenjs/core"] } }],
      ["another package", { buildSsr: true, ssr: { noExternal: ["other-pkg"] } }],
      ["a prefix lookalike", { buildSsr: true, ssr: { noExternal: ["@gwenjs/core-extra"] } }],
      ["external only", { buildSsr: true, ssr: { external: ["@gwenjs/core"] } }],
      [
        "noExternal true but core listed in external",
        { buildSsr: true, ssr: { noExternal: true, external: ["@gwenjs/core"] } },
      ],
    ];
    for (const [label, options] of quiet) {
      expect([label, await warningsOf(options)]).toEqual([label, []]);
    }
  });

  it("warns again on a second resolve with the same global RegExp", async () => {
    // A /g RegExp keeps `lastIndex` between `test` calls: the second resolve would miss.
    const sticky = /@gwenjs\/core/g;
    const warnings = await warningsOf({ buildSsr: true, ssr: { noExternal: sticky } }, 2);
    expect(warnings).toHaveLength(2);
  });
});
