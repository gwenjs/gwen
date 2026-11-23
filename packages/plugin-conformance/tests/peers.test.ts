import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_RANGE, FRAMEWORK_RANGES } from "@gwenjs/schema";
import { checkPluginPackage } from "@gwenjs/plugin-conformance";
import type { ConformanceFinding, ConformanceReport } from "@gwenjs/plugin-conformance";
import { openPeersFixture, peersOf } from "./helpers/peers.js";

const open = openPeersFixture();

const PEER_RANGE: string = "CONFORMANCE:PEER_RANGE";
const DEV_PIN: string = "CONFORMANCE:DEV_PIN";

const MATH = "@gwenjs/math";
const CORE = "@gwenjs/core";
const STAMP = "1.0.0-integration.20261123120000.gabc1234";

const PACKAGE_NAMES = Object.keys(FRAMEWORK_RANGES);

function rangeOf(name: string): string {
  const range = FRAMEWORK_RANGES[name];
  if (range === undefined) throw new Error(`no framework range for ${name}`);
  return range;
}

function peerImports(names: readonly string[]): Record<string, string> {
  const body = names.map((name) => `import ${JSON.stringify(name)};`).join("\n");
  return { "src/a.ts": `${body}\n` };
}

function run(root: string, profile: "plugin" | "package" = "plugin"): Promise<ConformanceReport> {
  return checkPluginPackage({ root, profile });
}

function shown(spec: unknown): string {
  return JSON.stringify(spec) ?? "";
}

function rangeMessage(name: string, spec: unknown, expected: string): string {
  return `peer ${JSON.stringify(name)} has range ${shown(spec)}, expected ${JSON.stringify(expected)}`;
}

function rangeHint(name: string, expected: string): string {
  return `Set the peerDependencies range of ${name} to ${JSON.stringify(expected)}.`;
}

function dependencyMessage(name: string): string {
  return `${name} is declared in dependencies, not in peerDependencies`;
}

function optionalMessage(name: string): string {
  return `${name} is declared in optionalDependencies, not in peerDependencies`;
}

function dependencyHint(name: string, expected: string): string {
  return `Move ${JSON.stringify(name)} to peerDependencies on ${JSON.stringify(expected)} and pin it exactly in devDependencies.`;
}

function devMessage(name: string, spec: string): string {
  return `devDependency ${JSON.stringify(name)} is ${JSON.stringify(spec)}, not an exact version`;
}

function devHint(name: string): string {
  return `Pin ${name} in devDependencies to the exact version the tests run against.`;
}

function peerFinding(
  code: string,
  message: string,
  hint: string,
  line: number,
): {
  code: string;
  file: string;
  line: number;
  message: string;
  hint: string;
} {
  return { code, file: "package.json", line, message, hint };
}

function shaped(finding: ConformanceFinding): {
  code: string;
  file: string | undefined;
  line: number | undefined;
  message: string;
  hint: string;
} {
  return {
    code: finding.code,
    file: finding.file,
    line: finding.line,
    message: finding.message,
    hint: finding.hint,
  };
}

function peersAtOwnRanges(): Record<string, string> {
  const peers: Record<string, string> = {};
  for (const name of PACKAGE_NAMES) peers[name] = rangeOf(name);
  return peers;
}

describe("peers check", () => {
  it("reports @gwenjs/core under dependencies", async () => {
    // line 3: "@gwenjs/core" under dependencies. line 6: the same key under peerDependencies.
    const fixture = await open(
      {
        dependencies: { [CORE]: CORE_RANGE },
        peerDependencies: { [CORE]: CORE_RANGE },
      },
      peerImports([CORE]),
    );

    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual([
      peerFinding(PEER_RANGE, dependencyMessage(CORE), dependencyHint(CORE, CORE_RANGE), 3),
    ]);
  });

  it("reports a peer range ^0.2.2 that is not CORE_RANGE", async () => {
    // line 3: peerDependencies "@gwenjs/core": "^0.2.2"
    const fixture = await open({ peerDependencies: { [CORE]: "^0.2.2" } }, peerImports([CORE]));

    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual([
      peerFinding(
        PEER_RANGE,
        rangeMessage(CORE, "^0.2.2", CORE_RANGE),
        rangeHint(CORE, CORE_RANGE),
        3,
      ),
    ]);
  });

  it("reports a devDependency range instead of an exact pin", async () => {
    // line 7: devDependencies "@gwenjs/core": <CORE_RANGE>. line 8: kit stamp, accepted.
    const fixture = await open(
      {
        peerDependencies: { [CORE]: CORE_RANGE, "@gwenjs/kit": CORE_RANGE },
        devDependencies: { [CORE]: CORE_RANGE, "@gwenjs/kit": STAMP },
      },
      peerImports([CORE, "@gwenjs/kit"]),
    );

    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual([
      peerFinding(DEV_PIN, devMessage(CORE, CORE_RANGE), devHint(CORE), 7),
    ]);
  });

  it("accepts @gwenjs/math as a dependency and as a peer on its FRAMEWORK_RANGES range", async () => {
    // line 3: dependencies "@gwenjs/math": "1.2.3" (any spec, no finding).
    // line 6: peer "@gwenjs/math" on its own range. line 7: peer "@gwenjs/core": "^0.2.2".
    const fixture = await open(
      {
        dependencies: { [MATH]: "1.2.3" },
        peerDependencies: { [MATH]: rangeOf(MATH), [CORE]: "^0.2.2" },
      },
      peerImports([MATH, CORE]),
    );

    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual([
      peerFinding(
        PEER_RANGE,
        rangeMessage(CORE, "^0.2.2", CORE_RANGE),
        rangeHint(CORE, CORE_RANGE),
        7,
      ),
    ]);
  });

  it("reports a CORE_RANGE peer on @gwenjs/math", async () => {
    // line 3: peerDependencies "@gwenjs/math": <CORE_RANGE>
    const fixture = await open({ peerDependencies: { [MATH]: CORE_RANGE } }, peerImports([MATH]));

    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual([
      peerFinding(
        PEER_RANGE,
        rangeMessage(MATH, CORE_RANGE, rangeOf(MATH)),
        rangeHint(MATH, rangeOf(MATH)),
        3,
      ),
    ]);
  });

  it("accepts every framework package on its own FRAMEWORK_RANGES range", async () => {
    const peers = peersAtOwnRanges();
    const broken = { ...peers, [CORE]: "^9.9.9" };
    const sources = peerImports(PACKAGE_NAMES);
    const good = await open({ peerDependencies: peers }, sources);
    const bad = await open({ peerDependencies: broken }, sources);

    const goodReport = await run(good.root);
    const badReport = await run(bad.root);
    // line 5: peerDependencies "@gwenjs/core": "^9.9.9" (third key of FRAMEWORK_RANGES).
    expect(peersOf(badReport).map(shaped)).toEqual([
      peerFinding(
        PEER_RANGE,
        rangeMessage(CORE, "^9.9.9", CORE_RANGE),
        rangeHint(CORE, CORE_RANGE),
        5,
      ),
    ]);
    expect(goodReport.checks).toContain("peers");
    expect(peersOf(goodReport)).toEqual([]);
  });

  it("reports every offending package once, sorted by line", async () => {
    // dependencies lines 3-13 (math is line 7 and is allowed). peerDependencies "*" lines 16-26.
    const dependencyLines = [3, 4, 5, 6, 8, 9, 10, 11, 12, 13] as const;
    const peerLines = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26] as const;
    const dependencies: Record<string, string> = {};
    const peerDependencies: Record<string, string> = {};
    for (const name of PACKAGE_NAMES) {
      dependencies[name] = CORE_RANGE;
      peerDependencies[name] = "*";
    }
    const fixture = await open({ dependencies, peerDependencies }, peerImports(PACKAGE_NAMES));

    const depNames = PACKAGE_NAMES.filter((name) => name !== MATH);
    if (depNames.length !== dependencyLines.length) {
      throw new Error(`dependency lines ${dependencyLines.length} do not match ${depNames.length}`);
    }
    if (PACKAGE_NAMES.length !== peerLines.length) {
      throw new Error(`peer lines ${peerLines.length} do not match ${PACKAGE_NAMES.length}`);
    }
    const expected = [
      ...depNames.map((name, index) => {
        const line = dependencyLines[index];
        if (line === undefined) throw new Error("dependency line");
        return peerFinding(
          PEER_RANGE,
          dependencyMessage(name),
          dependencyHint(name, rangeOf(name)),
          line,
        );
      }),
      ...PACKAGE_NAMES.map((name, index) => {
        const line = peerLines[index];
        if (line === undefined) throw new Error("peer line");
        return peerFinding(
          PEER_RANGE,
          rangeMessage(name, "*", rangeOf(name)),
          rangeHint(name, rangeOf(name)),
          line,
        );
      }),
    ];

    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual(expected);
  });

  it("ignores a peer on a package outside FRAMEWORK_RANGES", async () => {
    // line 3: "@gwenjs/plugin-conformance". line 4: "left-pad". line 5: "@gwenjs/core": "^0.2.2".
    const names = ["@gwenjs/plugin-conformance", "left-pad", CORE] as const;
    const fixture = await open(
      {
        peerDependencies: {
          "@gwenjs/plugin-conformance": "*",
          "left-pad": "*",
          [CORE]: "^0.2.2",
        },
      },
      peerImports(names),
    );

    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual([
      peerFinding(
        PEER_RANGE,
        rangeMessage(CORE, "^0.2.2", CORE_RANGE),
        rangeHint(CORE, CORE_RANGE),
        5,
      ),
    ]);
  });

  it("reports each non-exact devDependency spec", async () => {
    // devDependencies lines 3-10 are not exact. line 11 "1.0.0" and line 12 with a build are exact.
    const bad = [
      [CORE, "~1.0.0", 3],
      ["@gwenjs/kit", "*", 4],
      ["@gwenjs/schema", "latest", 5],
      [MATH, "workspace:^", 6],
      ["@gwenjs/renderer-core", ">=1.0.0", 7],
      ["@gwenjs/camera-core", "1.x", 8],
      ["@gwenjs/physics-core", "file:../x", 9],
      ["@gwenjs/app", "npm:x@1.0.0", 10],
    ] as const;
    const fixture = await open({
      devDependencies: {
        [CORE]: "~1.0.0",
        "@gwenjs/kit": "*",
        "@gwenjs/schema": "latest",
        [MATH]: "workspace:^",
        "@gwenjs/renderer-core": ">=1.0.0",
        "@gwenjs/camera-core": "1.x",
        "@gwenjs/physics-core": "file:../x",
        "@gwenjs/app": "npm:x@1.0.0",
        "@gwenjs/physics2d": "1.0.0",
        "@gwenjs/physics3d": "1.0.0-alpha.1+build.5",
      },
    });

    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual(
      bad.map(([name, spec, line]) =>
        peerFinding(DEV_PIN, devMessage(name, spec), devHint(name), line),
      ),
    );
  });

  it("runs for the package profile and with an empty or malformed block", async () => {
    const third = await open({ peerDependencies: { [CORE]: "^0.2.2" } }, peerImports([CORE]));
    const empty = await open({ peerDependencies: {} });
    const malformed = await open({ dependencies: "x", peerDependencies: [] });

    const thirdReport = await run(third.root, "package");
    const emptyReport = await run(empty.root, "package");
    const malformedReport = await run(malformed.root, "package");
    // line 3: peerDependencies "@gwenjs/core": "^0.2.2"
    expect(peersOf(thirdReport).map(shaped)).toEqual([
      peerFinding(
        PEER_RANGE,
        rangeMessage(CORE, "^0.2.2", CORE_RANGE),
        rangeHint(CORE, CORE_RANGE),
        3,
      ),
    ]);
    expect(emptyReport.checks).toContain("peers");
    expect(peersOf(emptyReport)).toEqual([]);
    expect(malformedReport.checks).toContain("peers");
    expect(peersOf(malformedReport)).toEqual([]);
  });

  it("puts a non-string spec in the message", async () => {
    // line 3: peerDependencies "@gwenjs/core": 5
    const fixture = await open({ peerDependencies: { [CORE]: 5 } }, peerImports([CORE]));

    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual([
      peerFinding(PEER_RANGE, rangeMessage(CORE, 5, CORE_RANGE), rangeHint(CORE, CORE_RANGE), 3),
    ]);
  });

  it("does not read a name from the prototype chain", async () => {
    // dependencies 3-5, peerDependencies 8-11 (core is line 11), devDependencies 14-16.
    const inherited = {
      constructor: "*",
      toString: "*",
      ...Object.fromEntries([["__proto__", "*"]]),
    };
    const fixture = await open(
      {
        dependencies: { ...inherited },
        peerDependencies: { ...inherited, [CORE]: "^0.2.2" },
        devDependencies: { ...inherited },
      },
      peerImports([CORE]),
    );

    const text = await readFile(path.join(fixture.root, "package.json"), "utf8");
    expect(text.match(/"__proto__": "\*"/g)?.length).toBe(3);
    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual([
      peerFinding(
        PEER_RANGE,
        rangeMessage(CORE, "^0.2.2", CORE_RANGE),
        rangeHint(CORE, CORE_RANGE),
        11,
      ),
    ]);
  });

  it("reports a framework package under optionalDependencies", async () => {
    // line 7: optionalDependencies "@gwenjs/core". line 8: "@gwenjs/math" (no finding).
    // peers are each package's own range and both are imported.
    const fixture = await open(
      {
        peerDependencies: { [CORE]: CORE_RANGE, [MATH]: rangeOf(MATH) },
        optionalDependencies: { [CORE]: CORE_RANGE, [MATH]: "1.2.3" },
      },
      peerImports([CORE, MATH]),
    );

    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual([
      peerFinding(PEER_RANGE, optionalMessage(CORE), dependencyHint(CORE, CORE_RANGE), 7),
    ]);
  });
});

describe("peers check: unused peers", () => {
  const PEER_UNUSED = "CONFORMANCE:PEER_UNUSED";
  const KIT = "@gwenjs/kit";
  const RENDERER = "@gwenjs/renderer-core";

  function unusedMessage(name: string): string {
    return `peer ${JSON.stringify(name)} is declared but src never uses it`;
  }

  function unusedHint(name: string): string {
    return `Remove ${JSON.stringify(name)} from peerDependencies, or import it from src.`;
  }

  it("reports a declared peer that is never imported", async () => {
    // line 4: peerDependencies "@gwenjs/kit". src/a.ts imports core only.
    // src/kit.test.ts, src/__tests__/k.ts and tests/b.test.ts import kit.
    const fixture = await open(
      { peerDependencies: { [CORE]: rangeOf(CORE), [KIT]: rangeOf(KIT) } },
      {
        "src/a.ts": `import ${JSON.stringify(CORE)};\n`,
        "src/kit.test.ts": `import ${JSON.stringify(KIT)};\n`,
        "src/__tests__/k.ts": `import ${JSON.stringify(KIT)};\n`,
        "tests/b.test.ts": `import ${JSON.stringify(KIT)};\n`,
      },
    );
    const bare = await open({ peerDependencies: { "left-pad": "*" } });

    const report = await run(fixture.root);
    const bareReport = await run(bare.root);
    expect(peersOf(report).map(shaped)).toEqual([
      peerFinding(PEER_UNUSED, unusedMessage(KIT), unusedHint(KIT), 4),
    ]);
    expect(bareReport.checks).toContain("peers");
    expect(peersOf(bareReport)).toEqual([]);
  });

  it("counts a declare module of the package as a use", async () => {
    // line 5: peerDependencies "@gwenjs/renderer-core". schema and kit are declared, not imported.
    // tests/types.d.ts declares renderer-core and must not count.
    const fixture = await open(
      {
        peerDependencies: {
          "@gwenjs/schema": rangeOf("@gwenjs/schema"),
          [KIT]: rangeOf(KIT),
          [RENDERER]: rangeOf(RENDERER),
        },
      },
      {
        "src/augment.d.ts":
          'export {};\ndeclare module "@gwenjs/schema" { interface GwenProvides { x: number } }\n',
        "src/kit.ts": 'export {};\ndeclare module "@gwenjs/kit" {}\n',
        "tests/types.d.ts": 'declare module "@gwenjs/renderer-core" {}\n',
      },
    );

    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual([
      peerFinding(PEER_UNUSED, unusedMessage(RENDERER), unusedHint(RENDERER), 5),
    ]);
  });

  it("counts a subpath and a type-only import as a use", async () => {
    // line 5: peerDependencies "@gwenjs/renderer-core". core and kit are type-only subpath uses.
    const fixture = await open(
      {
        peerDependencies: {
          [CORE]: rangeOf(CORE),
          [KIT]: rangeOf(KIT),
          [RENDERER]: rangeOf(RENDERER),
        },
      },
      {
        "src/a.ts": [
          `import type { X } from ${JSON.stringify(`${CORE}/system`)};`,
          `export type { Y } from ${JSON.stringify(`${KIT}/plugin`)};`,
          "",
        ].join("\n"),
      },
    );

    const report = await run(fixture.root);
    expect(peersOf(report).map(shaped)).toEqual([
      peerFinding(PEER_UNUSED, unusedMessage(RENDERER), unusedHint(RENDERER), 5),
    ]);
  });
});
