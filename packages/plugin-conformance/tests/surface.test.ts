import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPluginPackage, ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import type { ConformanceFinding, ConformanceReport } from "@gwenjs/plugin-conformance";
import {
  createFixture,
  editManifest,
  goodPluginRoot,
  manifestExports,
  writeManifestText,
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

  it("accepts a package profile without ./module", async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      delete manifestExports(manifest)["./module"];
    });

    const report = await checkPluginPackage({ root, profile: "package" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toEqual([]);
  });

  it("runs the exports and manifest checks on the clean fixture and reports nothing", async () => {
    const report: ConformanceReport = await checkPluginPackage({
      root: goodPluginRoot(),
      profile: "plugin",
    });
    expect(report.checks).toEqual(["exports", "hooks", "manifest"]);
    expect(report.findings).toEqual([]);
  });

  it("does not existence-check a subpath pattern target", async () => {
    const root = await openPackage();
    await editManifest(root, (manifest) => {
      manifestExports(manifest)["./x/*"] = "./dist/x/*.js";
    });

    const report = await checkPluginPackage({ root, profile: "plugin" });
    expect(report.checks).toContain("exports");
    expect(report.findings).toEqual([]);
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

  it("accepts a null exports target", async () => {
    const root = await openPackage();
    await writeManifestText(
      root,
      `{
  "name": "@fixture/null-target",
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
