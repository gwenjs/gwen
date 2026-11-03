import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkPluginPackage,
  checkSnapshot,
  ConformanceErrorCodes,
} from "@gwenjs/plugin-conformance";
import type { ConformanceFinding, ConformanceReport } from "@gwenjs/plugin-conformance";
import {
  createFixture,
  editManifest,
  goodPluginRoot,
  manifestExports,
  SLOW_TEST_MS,
  SNAPSHOT_FILE,
  writeManifestText,
  withPrivateTmpdir,
  writeSource,
} from "./helpers/fixture.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  const pending = cleanups.splice(0);
  for (const cleanup of pending) {
    await cleanup();
  }
});

async function openPackage(): Promise<string> {
  const fixture = await createFixture();
  cleanups.push(fixture.cleanup);
  return fixture.root;
}

function requireFinding(finding: ConformanceFinding | undefined): ConformanceFinding {
  expect(finding).toBeDefined();
  if (finding === undefined) throw new Error("missing finding");
  return finding;
}

describe("checkPluginPackage", () => {
  it("reports an exports target missing from dist", async () => {
    const root = await openPackage();
    await rm(path.join(root, "dist/index.js"));

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.file).toBe("package.json");
    expect(finding.line).toBe(9);
    expect(finding.message).toBe('export "./dist/index.js" of subpath "." is missing');
  });

  it("reports a types condition that is not first", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/good-plugin",
  "version": "0.0.0",
  "license": "MPL-2.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./module": {
      "types": "./dist/module.d.ts",
      "import": "./dist/module.js"
    }
  },
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.file).toBe("package.json");
    expect(finding.line).toBe(7);
    expect(finding.message).toBe('subpath "." lists condition "types" after another key');
  });

  it("reports a plugin without ./module and one with ./internal", async () => {
    const missingModule = await openPackage();
    const internal = await openPackage();
    await editManifest(missingModule, (manifest) => {
      delete manifestExports(manifest)["./module"];
    });
    await writeManifestText(
      internal,
      `{
  "name": "@fixture/good-plugin",
  "version": "0.0.0",
  "license": "MPL-2.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./module": {
      "types": "./dist/module.d.ts",
      "import": "./dist/module.js"
    },
    "./internal": "./dist/index.js"
  },
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const missingReport = await checkPluginPackage({ root: missingModule, profile: "plugin" });
    expect(missingReport.checks).toContain("exports");
    expect(missingReport.findings).toHaveLength(1);
    const missing = requireFinding(missingReport.findings[0]);
    expect(missing.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(missing.file).toBe("package.json");
    expect(missing.line).toBe(1);
    expect(missing.message).toBe('subpath "./module" is required for profile plugin');

    const internalReport = await checkPluginPackage({ root: internal, profile: "plugin" });
    expect(internalReport.checks).toContain("exports");
    expect(internalReport.findings).toHaveLength(1);
    const banned = requireFinding(internalReport.findings[0]);
    expect(banned.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(banned.file).toBe("package.json");
    expect(banned.line).toBe(15);
    expect(banned.message).toBe('subpath "./internal" is not a public export');
  });

  it("reports an exports target that leaves the package root", async () => {
    const root = await openPackage();
    await writeFile(path.resolve(root, "..", "outside.js"), "export {}\n");
    await writeManifestText(
      root,
      `{
  "name": "@fixture/good-plugin",
  "version": "0.0.0",
  "license": "MPL-2.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "../outside.js"
    },
    "./module": {
      "types": "./dist/module.d.ts",
      "import": "./dist/module.js"
    }
  },
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.file).toBe("package.json");
    expect(finding.line).toBe(9);
    expect(finding.message).toBe(
      'export "../outside.js" of subpath "." resolves outside the package root',
    );
  });

  it("accepts a package profile without ./module", { timeout: SLOW_TEST_MS }, async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      delete manifestExports(manifest)["./module"];
    });
    await writeSource(root, SNAPSHOT_FILE, '{".":{"values":["ready"],"types":[]}}\n');

    const report = await checkPluginPackage({ root, profile: "package" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toEqual([]);
  });

  it(
    "runs the exports and manifest checks on the clean fixture and reports nothing",
    { timeout: SLOW_TEST_MS },
    async () => {
      const report: ConformanceReport = await checkPluginPackage({
        root: goodPluginRoot(),
        profile: "plugin",
      });
      expect(report.checks).toEqual([
        "exports",
        "snapshot-values",
        "snapshot-types",
        "publint",
        "attw",
        "readme",
        "hooks",
        "test-mocks",
        "manifest",
      ]);
      expect(report.findings).toEqual([]);
    },
  );

  it("does not existence-check a subpath pattern target", { timeout: SLOW_TEST_MS }, async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      manifestExports(manifest)["./x/*"] = "./dist/x/*.js";
    });

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    // Only publint reports the pattern: `exports` does not existence-check it.
    expect(report.findings.map((finding) => [finding.code, finding.line, finding.message])).toEqual(
      [
        [
          ConformanceErrorCodes.PUBLINT,
          15,
          'pkg.exports["./x/*"] is ./dist/x/*.js but does not match any files.',
        ],
      ],
    );
  });

  it("reports the target line inside exports when main repeats it", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/main-before-exports",
  "license": "MPL-2.0",
  "main": "./dist/gone.js",
  "exports": {
    ".": "./dist/gone.js",
    "./module": "./dist/module.js"
  },
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.file).toBe("package.json");
    expect(finding.line).toBe(6);
    expect(finding.message).toBe('export "./dist/gone.js" of subpath "." is missing');
  });

  it("reports each subpath when two subpaths share a missing target", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/shared-target",
  "license": "MPL-2.0",
  "exports": {
    ".": "./dist/gone.js",
    "./alias": "./dist/gone.js"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "package" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(2);
    expect(report.findings.map((finding) => finding.line)).toEqual([5, 6]);
    expect(report.findings.map((finding) => finding.message)).toEqual([
      'export "./dist/gone.js" of subpath "." is missing',
      'export "./dist/gone.js" of subpath "./alias" is missing',
    ]);
  });

  it("reports the exports key line when a space precedes the colon", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/exports-spacing",
  "license": "MPL-2.0",
  "exports" : {},
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.line).toBe(4);
    expect(finding.message).toBe("exports must not be empty");
  });

  it("reports a subpath key line when a space precedes the colon", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/internal-spacing",
  "license": "MPL-2.0",
  "exports": {
    ".": "./dist/index.js",
    "./module": "./dist/module.js",
    "./internal" : "./dist/index.js"
  },
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    const banned = requireFinding(
      report.findings.find(
        (finding) => finding.message === 'subpath "./internal" is not a public export',
      ),
    );
    expect(banned.line).toBe(7);
  });

  it("reports an escaped target on its own line", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/escaped-target",
  "license": "MPL-2.0",
  "exports": {
    ".": "./dist\\/gone.js"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "package" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.line).toBe(5);
    expect(finding.message).toBe('export "./dist/gone.js" of subpath "." is missing');
  });

  it("reports a number or boolean exports target", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/bad-target",
  "license": "MPL-2.0",
  "exports": {
    ".": 42,
    "./module": true
  },
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings.map((finding) => finding.message)).toEqual([
      'export of subpath "." must be a string, an array, an object or null',
      'export of subpath "./module" must be a string, an array, an object or null',
    ]);
    expect(report.findings.map((finding) => finding.line)).toEqual([5, 6]);
    for (const finding of report.findings) {
      expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    }
  });

  it("reports mixed subpath and condition keys", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/mixed",
  "license": "MPL-2.0",
  "exports": {
    ".": "./dist/index.js",
    "import": "./dist/nope.js",
    "./module": "./dist/module.js"
  },
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.message).toBe('exports mixes subpath keys and condition key "import"');
  });

  it("reports a string target that does not start with ./", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/prefix",
  "license": "MPL-2.0",
  "exports": {
    ".": "dist/index.js",
    "./module": "./dist/module.js"
  },
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.message).toBe('export "dist/index.js" of subpath "." must start with "./"');
  });

  it("reports a plugin that omits the dot subpath", async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      delete manifestExports(manifest)["."];
    });

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.message).toBe('subpath "." is required for profile plugin');
  });

  it("reports an empty exports object", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/empty-exports",
  "license": "MPL-2.0",
  "exports": {},
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.message).toBe("exports must not be empty");
    expect(finding.line).toBe(4);
  });

  it("reports exports that is a string", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/string-exports",
  "license": "MPL-2.0",
  "exports": "./dist/index.js",
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.message).toBe("exports must be an object");
  });

  it("reports the exports key line when types is not first in the sugar form", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/sugar",
  "license": "MPL-2.0",
  "exports": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "package" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.line).toBe(4);
    expect(finding.message).toBe('subpath "." lists condition "types" after another key');
  });

  it("reports the missing entry of an array fallback", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/array-fallback",
  "license": "MPL-2.0",
  "exports": {
    ".": ["./dist/missing.js", "./dist/index.js"],
    "./module": "./dist/module.js"
  },
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.line).toBe(5);
    expect(finding.message).toBe('export "./dist/missing.js" of subpath "." is missing');
  });

  it("accepts a null exports target", { timeout: SLOW_TEST_MS }, async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/null-target",
  "version": "0.0.0",
  "type": "module",
  "license": "MPL-2.0",
  "exports": {
    ".": null,
    "./module": "./dist/module.js"
  },
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toEqual([]);
  });

  it("reports a subpath key that starts with ./internal*", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/internal-star",
  "license": "MPL-2.0",
  "exports": {
    ".": "./dist/index.js",
    "./module": "./dist/module.js",
    "./internal*": "./dist/*.js"
  },
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.line).toBe(7);
    expect(finding.message).toBe('subpath "./internal*" is not a public export');
  });

  it("reports an unknown profile as INVALID_SPEC", async () => {
    const root = await openPackage();

    const report = await checkPluginPackage({ root, profile: "plugins" as "plugin" });
    expect(report.findings).toHaveLength(1);
    expect(report.checks).toEqual([]);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.INVALID_SPEC);
    expect(finding.code).toBe("CONFORMANCE:INVALID_SPEC");
    expect(finding.message).toBe(
      'profile "plugins" is not valid. Allowed values: "plugin", "package"',
    );
    expect(finding.hint).toBe('Pass profile "plugin" or "package".');
    expect(finding.file).toBeUndefined();
    expect(finding.line).toBeUndefined();
  });

  it("reports lines from the top-level exports key when a nested exports key comes first", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/nested-exports-first",
  "license": "MPL-2.0",
  "scripts": { "exports": "x" },
  "exports": {},
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.EXPORTS_INVALID);
    expect(finding.message).toBe("exports must not be empty");
    expect(finding.line).toBe(5);
  });

  it("reports the line of the right condition when sibling conditions share a nested key name", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/sibling-conditions",
  "license": "MPL-2.0",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": { "default": "./dist/gone.js" },
      "default": "./dist/gone.js"
    },
    "./module": "./dist/module.js"
  },
  "gwen": {
    "type": "plugin"
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(2);
    expect(report.findings.map((finding) => finding.line)).toEqual([7, 8]);
    expect(report.findings.map((finding) => finding.message)).toEqual([
      'export "./dist/gone.js" of subpath "." is missing',
      'export "./dist/gone.js" of subpath "." is missing',
    ]);
  });

  it("locates every finding of a 4000-subpath exports map", async () => {
    const root = await openPackage();
    const count = 4000;
    const pad = "p".repeat(150);
    const subpaths: string[] = [];
    for (let index = 0; index < count; index += 1) {
      subpaths.push(`    "./subpath-${index}-${pad}": "./dist/missing-${index}.js"`);
    }
    await writeManifestText(
      root,
      `{
  "name": "@fixture/many-subpaths",
  "license": "MPL-2.0",
  "exports": {
${subpaths.join(",\n")}
  }
}
`,
    );

    const report = await checkPluginPackage({ root, profile: "package" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toHaveLength(count);
    const first = requireFinding(report.findings[0]);
    const middle = requireFinding(report.findings[2000]);
    const last = requireFinding(report.findings[count - 1]);
    expect(first.line).toBe(5);
    expect(first.message).toBe(
      `export "./dist/missing-0.js" of subpath "./subpath-0-${pad}" is missing`,
    );
    expect(middle.line).toBe(2005);
    expect(middle.message).toBe(
      `export "./dist/missing-2000.js" of subpath "./subpath-2000-${pad}" is missing`,
    );
    expect(last.line).toBe(4004);
    expect(last.message).toBe(
      `export "./dist/missing-3999.js" of subpath "./subpath-3999-${pad}" is missing`,
    );
  });
});

function snapshotText(entries: Record<string, { values: string[]; types: string[] }>): string {
  return `${JSON.stringify(entries)}\n`;
}

function messagesOf(report: ConformanceReport): string[] {
  return report.findings.map((finding) => finding.message);
}

async function setExports(root: string, value: unknown): Promise<void> {
  const text = await readFile(path.join(root, "package.json"), "utf8");
  const manifest: Record<string, unknown> = JSON.parse(text);
  manifest.exports = value;
  await writeManifestText(root, JSON.stringify(manifest));
}

async function appendTo(root: string, relative: string, extra: string): Promise<void> {
  const text = await readFile(path.join(root, relative), "utf8");
  await writeSource(root, relative, `${text}${extra}`);
}

describe("snapshot checks of checkPluginPackage", () => {
  it("skips the snapshot checks when exports has a finding", async () => {
    const root = await openPackage();
    await rm(path.join(root, "dist/index.js"));
    await rm(path.join(root, SNAPSHOT_FILE));

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toEqual(["exports", "hooks", "test-mocks", "manifest"]);
    expect(messagesOf(report)).toEqual(['export "./dist/index.js" of subpath "." is missing']);
  });
});

const FALLBACK_ARRAY_MESSAGE =
  'pkg.exports["./list"] uses fallback arrays which is not recommended. It picks the first value that can be parsed and does not have a use case in Node.js currently. It also works differently in some tools and may face inconsistent behaviors.';

describe("checkSnapshot", () => {
  it("reports a value added and a value removed against public-api.snap.json", async () => {
    const root = await openPackage();
    await writeSource(
      root,
      SNAPSHOT_FILE,
      snapshotText({
        ".": { values: ["ghost"], types: [] },
        "./module": { values: ["default"], types: [] },
      }),
    );

    const report = await checkSnapshot(root);
    expect(report.checks).toEqual(["snapshot-values", "snapshot-types"]);
    expect(messagesOf(report)).toEqual([
      'public-api.snap.json lists value "ghost" for subpath "." that the build does not export',
      'subpath "." exports value "ready" that public-api.snap.json does not list',
    ]);
    for (const finding of report.findings) {
      expect(finding.code).toBe(ConformanceErrorCodes.SNAPSHOT_MISMATCH);
      expect(finding.file).toBe(SNAPSHOT_FILE);
      expect(finding.line).toBeUndefined();
      expect(finding.hint.length).toBeGreaterThan(0);
    }
  });

  it("reports a type export missing from the snapshot", { timeout: SLOW_TEST_MS }, async () => {
    const root = await openPackage();
    await appendTo(root, "dist/index.d.ts", "export interface Extra {}\n");
    const message = 'subpath "." exports type "Extra" that public-api.snap.json does not list';

    const report = await checkSnapshot(root);
    expect(messagesOf(report)).toEqual([message]);
    expect(report.findings[0]?.code).toBe(ConformanceErrorCodes.SNAPSHOT_MISMATCH);
    const full = await checkPluginPackage({ root, profile: "plugin" });
    expect(messagesOf(full)).toEqual([message]);
  });

  it("lists enums and classes as values and aliases as types", async () => {
    const root = await openPackage();
    await writeSource(
      root,
      "dist/index.d.ts",
      [
        "export declare enum Mode { A }",
        "export declare class Box {}",
        "export type Id = string;",
        "export declare const impl: number;",
        "export type { impl as Impl };",
        "",
      ].join("\n"),
    );
    await writeSource(
      root,
      SNAPSHOT_FILE,
      snapshotText({
        ".": { values: ["Box", "Mode", "impl"], types: ["Id", "Impl"] },
        "./module": { values: ["default"], types: [] },
      }),
    );

    const report = await checkSnapshot(root);
    expect(report.checks).toEqual(["snapshot-values", "snapshot-types"]);
    expect(report.findings).toEqual([]);
  });

  it("reports an underscore value in a public entry", async () => {
    const root = await openPackage();
    await appendTo(
      root,
      "dist/index.d.ts",
      "export declare const _hidden: number;\nexport declare const __brand: number;\n",
    );
    await writeSource(
      root,
      SNAPSHOT_FILE,
      snapshotText({
        ".": { values: ["_hidden", "ready"], types: [] },
        "./module": { values: ["default"], types: [] },
      }),
    );

    const report = await checkSnapshot(root);
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.PRIVATE_EXPORT);
    expect(finding.message).toBe('value "_hidden" of subpath "." starts with "_"');
    expect(finding.file).toBe("dist/index.d.ts");
  });

  it("reports a missing or invalid snapshot file once", async () => {
    const missing = await openPackage();
    const invalid = await openPackage();
    const shape = await openPackage();
    const list = await openPackage();
    const directory = await openPackage();
    await rm(path.join(missing, SNAPSHOT_FILE));
    await writeSource(invalid, SNAPSHOT_FILE, "{");
    await writeSource(shape, SNAPSHOT_FILE, '{".":{"values":"ready","types":[]}}');
    await writeSource(list, SNAPSHOT_FILE, "[]");
    await rm(path.join(directory, SNAPSHOT_FILE));
    await mkdir(path.join(directory, SNAPSHOT_FILE));

    expect(messagesOf(await checkSnapshot(missing))).toEqual(["public-api.snap.json is missing"]);
    expect(messagesOf(await checkSnapshot(invalid))).toEqual([
      "public-api.snap.json is not valid JSON",
    ]);
    const invalidShape = await checkSnapshot(shape);
    expect(messagesOf(invalidShape)).toEqual(["public-api.snap.json has an invalid shape"]);
    expect(invalidShape.findings[0]?.code).toBe(ConformanceErrorCodes.SNAPSHOT_MISMATCH);
    expect(messagesOf(await checkSnapshot(list))).toEqual([
      "public-api.snap.json has an invalid shape",
    ]);
    const unreadable = await checkSnapshot(directory);
    expect(messagesOf(unreadable)).toEqual(["public-api.snap.json cannot be read (EISDIR)"]);
    expect(unreadable.findings[0]?.code).toBe(ConformanceErrorCodes.SNAPSHOT_MISMATCH);
    expect(unreadable.findings[0]?.hint).not.toContain("Create");
  });

  it("reports a package.json that is missing", async () => {
    const root = await openPackage();
    await rm(path.join(root, "package.json"));

    const report = await checkSnapshot(root);
    expect(report.checks).toEqual(["snapshot-values", "snapshot-types"]);
    expect(messagesOf(report)).toEqual(["package.json is missing"]);
    expect(report.findings[0]?.code).toBe(ConformanceErrorCodes.MANIFEST);
  });

  it("reports a snapshot subpath that exports does not have and an exports subpath missing from the snapshot", async () => {
    const root = await openPackage();
    await writeSource(
      root,
      SNAPSHOT_FILE,
      snapshotText({
        ".": { values: ["ready"], types: [] },
        "./extra": { values: [], types: [] },
      }),
    );

    const report = await checkSnapshot(root);
    expect(messagesOf(report)).toEqual([
      'public-api.snap.json lists subpath "./extra" that exports does not have',
      'subpath "./module" is in exports but not in public-api.snap.json',
    ]);
  });

  it("reports a subpath whose module entry is not built", async () => {
    const partial = await openPackage();
    const unbuilt = await openPackage();
    await rm(path.join(partial, "dist/module.d.ts"));
    await rm(path.join(partial, "dist/module.js"));
    await rm(path.join(unbuilt, "dist"), { recursive: true });

    expect(messagesOf(await checkSnapshot(partial))).toEqual([
      'subpath "./module" declares "./dist/module.d.ts", which is not built',
    ]);
    const report = await checkSnapshot(unbuilt);
    expect(messagesOf(report)).toEqual([
      'subpath "." declares "./dist/index.d.ts", which is not built',
      'subpath "./module" declares "./dist/module.d.ts", which is not built',
    ]);
    for (const finding of report.findings) {
      expect(finding.code).toBe(ConformanceErrorCodes.SNAPSHOT_MISMATCH);
      expect(finding.file).toBe(SNAPSHOT_FILE);
    }
  });

  it("never requires a subpath whose target is a pattern or not a module entry", async () => {
    const root = await openPackage();
    await writeSource(root, "dist/data.json", "{}\n");
    await editManifest(root, (manifest) => {
      const subpaths = manifestExports(manifest);
      subpaths["./data"] = "./dist/data.json";
      subpaths["./x/*"] = "./dist/x/*.js";
      subpaths["./y/*"] = { types: "./dist/y/*.d.ts" };
    });

    const report = await checkSnapshot(root);
    expect(report.checks).toEqual(["snapshot-values", "snapshot-types"]);
    expect(report.findings).toEqual([]);
  });

  it("accepts an empty snapshot entry for a package with no public value", async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      delete manifestExports(manifest)["./module"];
    });
    await writeSource(root, "dist/index.d.ts", "export interface Only {}\n");
    await writeSource(root, SNAPSHOT_FILE, snapshotText({ ".": { values: [], types: ["Only"] } }));
    const bare = await openPackage();
    await editManifest(bare, (manifest) => {
      delete manifestExports(manifest)["./module"];
    });
    await writeSource(bare, "dist/index.d.ts", "export {};\n");
    await writeSource(bare, SNAPSHOT_FILE, snapshotText({ ".": { values: [], types: [] } }));

    for (const pkg of [root, bare]) {
      const report = await checkSnapshot(pkg);
      expect(report.checks).toEqual(["snapshot-values", "snapshot-types"]);
      expect(report.findings).toEqual([]);
    }
  });

  it("shares no state between two packages checked in sequence", async () => {
    const full = await openPackage();
    const single = await openPackage();
    await editManifest(single, (manifest) => {
      delete manifestExports(manifest)["./module"];
    });
    await writeSource(
      single,
      SNAPSHOT_FILE,
      snapshotText({ ".": { values: ["ready"], types: [] } }),
    );
    await appendTo(full, "dist/index.d.ts", "export interface Extra {}\n");

    const extra = ['subpath "." exports type "Extra" that public-api.snap.json does not list'];
    expect(messagesOf(await checkSnapshot(full))).toEqual(extra);
    expect((await checkSnapshot(single)).findings).toEqual([]);
    expect(messagesOf(await checkSnapshot(full))).toEqual(extra);
  });

  it(
    "reports a subpath whose target declares no types or import file",
    { timeout: SLOW_TEST_MS },
    async () => {
      const root = await openPackage();
      await setExports(root, {
        ".": { import: { types: "./dist/index.d.ts", default: "./dist/index.js" } },
        "./module": { types: "./dist/module.d.ts", import: "./dist/module.js" },
        "./extra": { default: "./dist/index.js" },
        "./list": ["./dist/index.js"],
        "./blocked": null,
      });
      await writeSource(
        root,
        SNAPSHOT_FILE,
        snapshotText({
          ".": { values: ["WRONG"], types: [] },
          "./module": { values: ["default"], types: [] },
          "./extra": { values: ["WRONG"], types: [] },
          "./list": { values: ["WRONG"], types: [] },
        }),
      );
      await writeSource(root, "README.md", "The names ready and WRONG are listed.\n");
      const messages = [
        'subpath "." declares no types or import file',
        'subpath "./extra" declares no types or import file',
        'subpath "./list" declares no types or import file',
      ];

      const report = await checkSnapshot(root);
      expect(messagesOf(report)).toEqual(messages);
      for (const finding of report.findings) {
        expect(finding.code).toBe(ConformanceErrorCodes.SNAPSHOT_MISMATCH);
        expect(finding.file).toBe(SNAPSHOT_FILE);
      }
      const full = await checkPluginPackage({ root, profile: "plugin" });
      expect(messagesOf(full)).toEqual([FALLBACK_ARRAY_MESSAGE, ...messages]);
    },
  );

  it("splits re-exports into values and types", async () => {
    const root = await openPackage();
    await writeSource(
      root,
      "dist/index.d.ts",
      [
        'export { ready } from "./impl.js";',
        'export { type T, helper as aliased } from "./impl.js";',
        'export type * from "./shapes.js";',
        "",
      ].join("\n"),
    );
    await writeSource(
      root,
      "dist/impl.d.ts",
      [
        "export declare const ready: boolean;",
        "export declare const helper: number;",
        "export interface T {}",
        "",
      ].join("\n"),
    );
    await writeSource(root, "dist/shapes.d.ts", "export interface Shape {}\n");
    await writeSource(
      root,
      SNAPSHOT_FILE,
      snapshotText({
        ".": { values: ["aliased", "ready"], types: ["Shape", "T"] },
        "./module": { values: ["default"], types: [] },
      }),
    );

    expect((await checkSnapshot(root)).findings).toEqual([]);
    await writeSource(
      root,
      SNAPSHOT_FILE,
      snapshotText({
        ".": { values: ["aliased"], types: ["Shape", "T", "ready"] },
        "./module": { values: ["default"], types: [] },
      }),
    );
    expect(messagesOf(await checkSnapshot(root))).toEqual([
      'public-api.snap.json lists type "ready" for subpath "." that the build does not export',
      'subpath "." exports value "ready" that public-api.snap.json does not list',
    ]);
  });

  it.each([
    ["the string form of exports", "./dist/index.d.ts"],
    [
      "conditions at the root of exports",
      { types: "./dist/index.d.ts", import: "./dist/index.js" },
    ],
    ["a types.import target", { types: { import: "./dist/index.d.ts" }, import: "./dist/gone.js" }],
    ["an import-only target read as JavaScript", { import: "./dist/index.js" }],
  ])("reads %s", async (_name, exportsField) => {
    const root = await openPackage();
    await setExports(root, exportsField);
    const listing = (values: string[]) => snapshotText({ ".": { values, types: [] } });
    await writeSource(root, SNAPSHOT_FILE, listing(["ready"]));
    expect((await checkSnapshot(root)).findings).toEqual([]);

    await writeSource(root, SNAPSHOT_FILE, listing(["WRONG"]));
    expect(messagesOf(await checkSnapshot(root))).toEqual([
      'public-api.snap.json lists value "WRONG" for subpath "." that the build does not export',
      'subpath "." exports value "ready" that public-api.snap.json does not list',
    ]);
  });
});

const EXPECTED_SNAPSHOT = [
  "{",
  '  ".": {',
  '    "values": [',
  '      "ready"',
  "    ],",
  '    "types": []',
  "  },",
  '  "./module": {',
  '    "values": [',
  '      "default"',
  "    ],",
  '    "types": []',
  "  }",
  "}",
  "",
].join("\n");

const STALE_SNAPSHOT = snapshotText({
  ".": { values: ["ghost"], types: [] },
  "./module": { values: ["default"], types: [] },
});

function snapshotBytes(root: string): Promise<string> {
  return readFile(path.join(root, SNAPSHOT_FILE), "utf8");
}

/** Positive control: on a valid built package, `write` replaces a stale snapshot. */
async function expectWriteRepairsStaleSnapshot(root: string): Promise<void> {
  await writeSource(root, SNAPSHOT_FILE, STALE_SNAPSHOT);
  expect((await checkSnapshot(root, { write: true })).findings).toEqual([]);
  expect(await snapshotBytes(root)).toBe(EXPECTED_SNAPSHOT);
}

describe("checkSnapshot with write", () => {
  it("points a value mismatch to gwen-conformance check --write", async () => {
    const root = await openPackage();
    await writeSource(root, SNAPSHOT_FILE, STALE_SNAPSHOT);

    const hints = (await checkSnapshot(root)).findings.map((finding) => finding.hint);
    expect(hints).toEqual([
      "Run gwen-conformance check --write to update public-api.snap.json, or change the export.",
      "Run gwen-conformance check --write to update public-api.snap.json, or change the export.",
    ]);
  });

  it("writes the gwen snapshot format byte for byte", async () => {
    const root = await openPackage();
    await rm(path.join(root, SNAPSHOT_FILE));

    expect((await checkSnapshot(root, { write: true })).findings).toEqual([]);
    expect(await snapshotBytes(root)).toBe(EXPECTED_SNAPSHOT);
    expect((await checkSnapshot(root, { write: true })).findings).toEqual([]);
    expect(await snapshotBytes(root)).toBe(EXPECTED_SNAPSHOT);

    const compact = snapshotText({
      ".": { values: ["ready"], types: [] },
      "./module": { values: ["default"], types: [] },
    });
    await writeSource(root, SNAPSHOT_FILE, compact);
    expect((await checkSnapshot(root, { write: true })).findings).toEqual([]);
    expect(await snapshotBytes(root)).toBe(compact);
  });

  it("keeps reporting an underscore value after a write", async () => {
    const root = await openPackage();
    await appendTo(root, "dist/index.d.ts", "export declare const _hidden: number;\n");
    await writeSource(root, SNAPSHOT_FILE, STALE_SNAPSHOT);

    const report = await checkSnapshot(root, { write: true });
    expect(report.findings.map((finding) => finding.code)).toEqual([
      ConformanceErrorCodes.PRIVATE_EXPORT,
    ]);
    expect(JSON.parse(await snapshotBytes(root))).toEqual({
      ".": { values: ["_hidden", "ready"], types: [] },
      "./module": { values: ["default"], types: [] },
    });
  });

  it("writes empty arrays for a package with no public value", async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      delete manifestExports(manifest)["./module"];
    });
    await writeSource(root, "dist/index.d.ts", "export {};\n");
    await rm(path.join(root, SNAPSHOT_FILE));

    expect((await checkSnapshot(root, { write: true })).findings).toEqual([]);
    expect(await snapshotBytes(root)).toBe(
      '{\n  ".": {\n    "values": [],\n    "types": []\n  }\n}\n',
    );
  });

  it("refuses to write when a subpath is not built or declares no types", async () => {
    await expectWriteRepairsStaleSnapshot(await openPackage());

    const unbuilt = await openPackage();
    const untyped = await openPackage();
    await rm(path.join(unbuilt, "dist/module.d.ts"));
    await setExports(untyped, {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./module": { types: "./dist/module.d.ts", import: "./dist/module.js" },
      "./extra": { default: "./dist/index.js" },
    });

    for (const [root, message] of [
      [unbuilt, 'subpath "./module" declares "./dist/module.d.ts", which is not built'],
      [untyped, 'subpath "./extra" declares no types or import file'],
    ] as const) {
      await writeSource(root, SNAPSHOT_FILE, STALE_SNAPSHOT);
      const read = await checkSnapshot(root);
      const written = await checkSnapshot(root, { write: true });
      expect(messagesOf(written)).toContain(message);
      expect(messagesOf(written)).toEqual(messagesOf(read));
      expect(await snapshotBytes(root)).toBe(STALE_SNAPSHOT);
    }
  });

  it("keeps the snapshot entry of a subpath whose target is not a module entry on write", async () => {
    const root = await openPackage();
    await writeSource(root, "dist/data.json", "{}\n");
    await editManifest(root, (manifest) => {
      manifestExports(manifest)["./data"] = "./dist/data.json";
    });
    await writeSource(
      root,
      SNAPSHOT_FILE,
      snapshotText({
        ".": { values: ["ghost"], types: [] },
        "./data": { values: ["kept"], types: ["Kept"] },
      }),
    );

    expect((await checkSnapshot(root, { write: true })).findings).toEqual([]);
    expect(JSON.parse(await snapshotBytes(root))).toEqual({
      ".": { values: ["ready"], types: [] },
      "./module": { values: ["default"], types: [] },
      "./data": { values: ["kept"], types: ["Kept"] },
    });
  });

  it("keeps the key order of the existing snapshot, appends new subpaths and drops removed ones", async () => {
    const root = await openPackage();
    await writeSource(root, "dist/extra.d.ts", "export declare const extra: number;\n");
    await editManifest(root, (manifest) => {
      manifestExports(manifest)["./extra"] = "./dist/extra.d.ts";
    });
    await writeSource(
      root,
      SNAPSHOT_FILE,
      snapshotText({
        "./module": { values: ["default"], types: [] },
        "./gone": { values: ["gone"], types: [] },
        ".": { values: ["ghost"], types: [] },
      }),
    );

    expect((await checkSnapshot(root, { write: true })).findings).toEqual([]);
    expect(await snapshotBytes(root)).toBe(
      [
        "{",
        '  "./module": {',
        '    "values": [',
        '      "default"',
        "    ],",
        '    "types": []',
        "  },",
        '  ".": {',
        '    "values": [',
        '      "ready"',
        "    ],",
        '    "types": []',
        "  },",
        '  "./extra": {',
        '    "values": [',
        '      "extra"',
        "    ],",
        '    "types": []',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("does not write when exports is missing", async () => {
    await expectWriteRepairsStaleSnapshot(await openPackage());

    const missing = await openPackage();
    const array = await openPackage();
    await editManifest(missing, (manifest) => {
      delete manifest.exports;
    });
    await setExports(array, ["./dist/index.js"]);

    for (const root of [missing, array]) {
      await writeSource(root, SNAPSHOT_FILE, STALE_SNAPSHOT);
      const read = await checkSnapshot(root);
      expect(read.findings).not.toEqual([]);
      expect(await checkSnapshot(root, { write: true })).toEqual(read);
      expect(await snapshotBytes(root)).toBe(STALE_SNAPSHOT);
    }
  });

  it("reports a snapshot that cannot be read instead of writing over it", async () => {
    await expectWriteRepairsStaleSnapshot(await openPackage());

    const root = await openPackage();
    await rm(path.join(root, SNAPSHOT_FILE));
    await mkdir(path.join(root, SNAPSHOT_FILE));

    const read = await checkSnapshot(root);
    expect(messagesOf(read)).toEqual([
      expect.stringMatching(/^public-api\.snap\.json cannot be read \(E[A-Z]+\)$/),
    ]);
    await expect(checkSnapshot(root, { write: true })).resolves.toEqual(read);
    expect((await stat(path.join(root, SNAPSHOT_FILE))).isDirectory()).toBe(true);
  });

  it("reports a finding when the snapshot cannot be written", async () => {
    const root = await openPackage();
    await writeSource(root, SNAPSHOT_FILE, STALE_SNAPSHOT);
    await mkdir(path.join(root, `${SNAPSHOT_FILE}.tmp`));

    const read = await checkSnapshot(root);
    const pending = checkSnapshot(root, { write: true });
    await expect(pending).resolves.toHaveProperty("findings.length", read.findings.length + 1);
    const written = await pending;
    const failed = written.findings.filter((finding) => finding.message.includes("cannot be"));
    expect(failed).toHaveLength(1);
    const finding = requireFinding(failed[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.SNAPSHOT_MISMATCH);
    expect(finding.file).toBe(SNAPSHOT_FILE);
    expect(finding.message).toMatch(/^public-api\.snap\.json cannot be written \(E[A-Z]+\)$/);
    expect(finding.hint.length).toBeGreaterThan(0);
    expect(messagesOf(written)).toEqual(expect.arrayContaining(messagesOf(read)));
    expect(await snapshotBytes(root)).toBe(STALE_SNAPSHOT);

    await rm(path.join(root, SNAPSHOT_FILE));
    const absent = await checkSnapshot(root, { write: true });
    expect(messagesOf(absent)).toEqual(
      expect.arrayContaining([
        "public-api.snap.json is missing",
        expect.stringMatching(/^public-api\.snap\.json cannot be written/),
      ]),
    );
    expect(absent.findings).toHaveLength(2);
  });
});

function readmeMessages(report: ConformanceReport): string[] {
  return report.findings
    .filter((finding) => finding.code === ConformanceErrorCodes.README_EXPORT_MISSING)
    .map((finding) => finding.message);
}

describe("readme check of checkPluginPackage", () => {
  it("reports a snapshot name absent from README", { timeout: SLOW_TEST_MS }, async () => {
    const root = await openPackage();
    await writeSource(root, "README.md", "Nothing to see.\n");

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("readme");
    expect(report.findings).toHaveLength(1);
    const finding = requireFinding(report.findings[0]);
    expect(finding.code).toBe(ConformanceErrorCodes.README_EXPORT_MISSING);
    expect(finding.file).toBe("README.md");
    expect(finding.message).toBe('README.md does not mention "ready" (subpath ".")');
    expect(finding.hint.length).toBeGreaterThan(0);
  });

  it(
    "asks for each README name once and never requires default",
    { timeout: SLOW_TEST_MS },
    async () => {
      const root = await openPackage();
      await writeSource(
        root,
        "dist/module.d.ts",
        "export declare const ready: boolean;\nexport default function setup(): void;\n",
      );
      await writeSource(
        root,
        SNAPSHOT_FILE,
        snapshotText({
          ".": { values: ["ready"], types: [] },
          "./module": { values: ["default", "ready"], types: [] },
        }),
      );
      await writeSource(root, "README.md", "Nothing to see.\n");

      const report = await checkPluginPackage({ root, profile: "plugin" });
      expect(messagesOf(report)).toEqual(['README.md does not mention "ready" (subpath ".")']);
    },
  );

  it("reports a missing README once", { timeout: SLOW_TEST_MS }, async () => {
    const root = await openPackage();
    await appendTo(root, "dist/index.d.ts", "export interface Extra {}\n");
    await writeSource(
      root,
      SNAPSHOT_FILE,
      snapshotText({
        ".": { values: ["ready"], types: ["Extra"] },
        "./module": { values: ["default"], types: [] },
      }),
    );
    await rm(path.join(root, "README.md"));

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(messagesOf(report)).toEqual(["README.md is missing"]);
    expect(report.findings[0]?.code).toBe(ConformanceErrorCodes.README_EXPORT_MISSING);
  });

  it("matches README names as whole identifiers", { timeout: SLOW_TEST_MS }, async () => {
    const root = await openPackage();
    await writeSource(root, "README.md", "readyState, $ready and ready_ are other names.\n");
    expect(readmeMessages(await checkPluginPackage({ root, profile: "plugin" }))).toEqual([
      'README.md does not mention "ready" (subpath ".")',
    ]);

    await writeSource(root, "README.md", "Call ready() first.\n");
    expect((await checkPluginPackage({ root, profile: "plugin" })).findings).toEqual([]);
  });

  it("matches a README name that holds regexp characters", { timeout: SLOW_TEST_MS }, async () => {
    const root = await openPackage();
    await writeSource(
      root,
      SNAPSHOT_FILE,
      snapshotText({
        ".": { values: ["$store", "ready"], types: [] },
        "./module": { values: ["default"], types: [] },
      }),
    );
    await writeSource(root, "README.md", "Call ready() and $store.\n");
    expect(readmeMessages(await checkPluginPackage({ root, profile: "plugin" }))).toEqual([]);

    await writeSource(root, "README.md", "Call ready() and store.\n");
    expect(readmeMessages(await checkPluginPackage({ root, profile: "plugin" }))).toEqual([
      'README.md does not mention "$store" (subpath ".")',
    ]);
  });

  it(
    "does not need a README when the snapshot holds only default",
    { timeout: SLOW_TEST_MS },
    async () => {
      const named = await openPackage();
      await editManifest(named, (manifest) => {
        delete manifestExports(manifest)["./module"];
      });
      await writeSource(
        named,
        "dist/index.d.ts",
        "export default function setup(): void;\nexport declare const extra: number;\n",
      );
      await writeSource(
        named,
        SNAPSHOT_FILE,
        snapshotText({ ".": { values: ["default", "extra"], types: [] } }),
      );
      await writeSource(named, "README.md", "Nothing to see.\n");
      expect(messagesOf(await checkPluginPackage({ root: named, profile: "package" }))).toEqual([
        'README.md does not mention "extra" (subpath ".")',
      ]);

      const root = await openPackage();
      await editManifest(root, (manifest) => {
        delete manifestExports(manifest)["./module"];
      });
      await writeSource(root, "dist/index.d.ts", "export default function setup(): void;\n");
      await writeSource(
        root,
        SNAPSHOT_FILE,
        snapshotText({ ".": { values: ["default"], types: [] } }),
      );
      await rm(path.join(root, "README.md"));

      expect((await checkPluginPackage({ root, profile: "package" })).findings).toEqual([]);
    },
  );

  it(
    "reports a README that cannot be read, not a missing one",
    { timeout: SLOW_TEST_MS },
    async () => {
      const root = await openPackage();
      await rm(path.join(root, "README.md"));
      await mkdir(path.join(root, "README.md"));

      expect(readmeMessages(await checkPluginPackage({ root, profile: "plugin" }))).toEqual([
        expect.stringMatching(/^README\.md cannot be read \(E[A-Z]+\)$/),
      ]);
    },
  );

  it("skips the readme check when exports has a finding", { timeout: SLOW_TEST_MS }, async () => {
    const clean = await openPackage();
    await writeSource(clean, "README.md", "Nothing to see.\n");
    expect(messagesOf(await checkPluginPackage({ root: clean, profile: "plugin" }))).toEqual([
      'README.md does not mention "ready" (subpath ".")',
    ]);

    const root = await openPackage();
    await rm(path.join(root, "dist/index.js"));
    await writeSource(root, "README.md", "Nothing to see.\n");

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toEqual(["exports", "hooks", "test-mocks", "manifest"]);
    expect(messagesOf(report)).toEqual(['export "./dist/index.js" of subpath "." is missing']);
  });

  it("reads the snapshot after a write", { timeout: SLOW_TEST_MS }, async () => {
    const root = await openPackage();
    await writeSource(root, SNAPSHOT_FILE, STALE_SNAPSHOT);
    await writeSource(root, "README.md", "Nothing to see.\n");

    const report = await checkPluginPackage({ root, profile: "plugin", write: true });
    expect(messagesOf(report)).toEqual(['README.md does not mention "ready" (subpath ".")']);
    expect(await snapshotBytes(root)).toBe(EXPECTED_SNAPSHOT);
  });
});

describe("artifact checks of checkPluginPackage", () => {
  const SLOW = { timeout: SLOW_TEST_MS };

  function summary(
    report: ConformanceReport,
  ): Array<[string, string | undefined, number | undefined, string]> {
    return report.findings.map((finding) => [
      finding.code,
      finding.file,
      finding.line,
      finding.message,
    ]);
  }

  it("reports a publint strict error verbatim", SLOW, async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      manifest.repository = "nope";
    });

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(summary(report)).toEqual([
      [
        ConformanceErrorCodes.PUBLINT,
        "package.json",
        19,
        "pkg.repository is nope which isn't a valid shorthand value supported by npm. Consider using an object that references a repository.",
      ],
    ]);
  });

  /** The fixture with `./module` declared without types: attw reports it as untyped. */
  async function openUntypedModule(): Promise<string> {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      manifestExports(manifest)["./module"] = { import: "./dist/module.js" };
    });
    await rm(path.join(root, "dist/module.d.ts"));
    return root;
  }

  const UNTYPED_MODULE = [
    [
      ConformanceErrorCodes.ATTW,
      "package.json",
      11,
      'UntypedResolution at "./module" (node16-esm, bundler)',
    ],
  ];

  it("reports an attw problem", SLOW, async () => {
    const root = await openUntypedModule();

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(summary(report)).toEqual(UNTYPED_MODULE);
  });

  it(
    "reports one attw finding per untyped subpath, whatever the size of the attw report",
    SLOW,
    async () => {
      // attw writes about 30 KiB per subpath and exits at once: a piped stdout is cut at 64 KiB.
      const root = await openPackage();
      const names = ["a", "b", "c", "d"];
      await editManifest(root, (manifest) => {
        for (const name of names) {
          manifestExports(manifest)[`./${name}`] = { import: `./dist/${name}.js` };
        }
      });
      for (const name of names) await writeSource(root, `dist/${name}.js`, "export {};\n");

      const report = await checkPluginPackage({ root, profile: "plugin" });
      expect(summary(report).filter(([code]) => code === ConformanceErrorCodes.ATTW)).toEqual(
        names.map((name, index) => [
          ConformanceErrorCodes.ATTW,
          "package.json",
          15 + index * 3,
          `UntypedResolution at "./${name}" (node16-esm, bundler)`,
        ]),
      );
    },
  );

  it("ignores the .attw.json of the package", SLOW, async () => {
    for (const config of [{ excludeEntrypoints: ["./module"] }, { entrypoints: ["."] }]) {
      const root = await openUntypedModule();
      await writeSource(root, ".attw.json", JSON.stringify(config));

      const report = await checkPluginPackage({ root, profile: "plugin" });
      expect(summary(report), JSON.stringify(config)).toEqual(UNTYPED_MODULE);
    }
  });

  it("leaves no temp directory behind", SLOW, async () => {
    const root = await openUntypedModule();

    await withPrivateTmpdir(async (tmp) => {
      const report = await checkPluginPackage({ root, profile: "plugin" });
      expect(summary(report)).toEqual(UNTYPED_MODULE);
      expect(
        (await readdir(tmp)).filter((name) => name.startsWith("gwen-conformance-attw-")),
      ).toEqual([]);
    });
  });

  it("reports an attw problem that names a file, not an entry point", SLOW, async () => {
    const root = await openPackage();
    await writeSource(root, "dist/index.d.cts", "export declare const ready: boolean;\n");
    await editManifest(root, (manifest) => {
      manifestExports(manifest)["."] = { types: "./dist/index.d.cts", import: "./dist/index.js" };
    });

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(summary(report)).toEqual([
      [ConformanceErrorCodes.ATTW, "package.json", 6, 'FalseCJS in "dist/index.d.cts"'],
    ]);
  });

  it("reports a package that ships no types", SLOW, async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      manifest.exports = { ".": "./dist/index.js", "./module": "./dist/module.js" };
    });
    await rm(path.join(root, "dist/index.d.ts"));
    await rm(path.join(root, "dist/module.d.ts"));
    await rm(path.join(root, "src"), { recursive: true });

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.findings.map((finding) => [finding.code, finding.message])).toEqual([
      [ConformanceErrorCodes.ATTW, "the package ships no TypeScript types"],
    ]);
  });

  it("reports a package that npm cannot pack", SLOW, async () => {
    const root = await openPackage();
    const manifest = {
      license: "MPL-2.0",
      exports: { ".": "./dist/index.js", "./module": "./dist/module.js" },
      gwen: { type: "plugin" },
    };
    await writeManifestText(root, `${JSON.stringify(manifest, null, 2)}\n`);

    // publint leaves an empty publint-pack-* directory when it cannot pack (@publint/pack
    // creates it before its try block): keep it out of the real temp dir.
    const report = await withPrivateTmpdir(() => checkPluginPackage({ root, profile: "plugin" }));
    expect(report.findings.map((finding) => [finding.code, finding.message])).toEqual([
      [
        ConformanceErrorCodes.PUBLINT,
        "publint failed: npm error Invalid package, must have name and version",
      ],
      [
        ConformanceErrorCodes.ATTW,
        "npm pack failed: npm error Invalid package, must have name and version",
      ],
    ]);
  });

  it("drops the node10 and node16-cjs resolutions of attw", SLOW, async () => {
    // attw reports NoResolution (node10) and CJSResolvesToESM (node16-cjs) for this ESM-only package.
    const report = await checkPluginPackage({ root: goodPluginRoot(), profile: "plugin" });
    expect(report.checks).toContain("attw");
    expect(
      report.findings.filter((finding) => finding.code === ConformanceErrorCodes.ATTW),
    ).toEqual([]);
  });

  it("skips publint and attw when exports has a finding", SLOW, async () => {
    const clean = await openPackage();
    await editManifest(clean, (manifest) => {
      manifest.repository = "nope";
    });
    const cleanReport = await checkPluginPackage({ root: clean, profile: "plugin" });
    expect(cleanReport.checks).toContain("publint");
    expect(cleanReport.checks).toContain("attw");
    expect(cleanReport.findings.map((finding) => finding.code)).toEqual([
      ConformanceErrorCodes.PUBLINT,
    ]);

    const root = await openPackage();
    await editManifest(root, (manifest) => {
      manifest.repository = "nope";
    });
    await rm(path.join(root, "dist/index.js"));

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toEqual(["exports", "hooks", "test-mocks", "manifest"]);
    expect(messagesOf(report)).toEqual(['export "./dist/index.js" of subpath "." is missing']);
  });
});
