import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineComponent, Types } from "../../src/schema";

const Position = defineComponent({
  name: "PositionAccessProbe",
  schema: { x: Types.f32, y: Types.f32 },
});

describe("component access rejected by the type checker", () => {
  it("rejects Position.x indexed by an entity id or a row", () => {
    const id = 0n;
    const row = 0;
    // The lines stay in a function tsc checks. Calling them would throw: the field is not there.
    const rejected = () => {
      // @ts-expect-error TS2339 — ComponentDefinition has no field keys
      void Position.x[id];
      // @ts-expect-error TS2339 — ComponentDefinition has no field keys
      Position.x[id] += 0.5;
      // @ts-expect-error TS2339 — ComponentDefinition has no field keys
      void Position.x[row];
    };
    expect(typeof rejected).toBe("function");
    expect(Position.name).toBe("PositionAccessProbe");
  });

  it("reports TS2339 on the Position.x line", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const configPath = resolve(here, "../../tsconfig.test.json");
    const probeName = resolve(here, "component-access.probe.ts");
    const probeSource = [
      'import { defineComponent, Types } from "../../src/schema";',
      'const Position = defineComponent({ name: "PositionAccessProbe", schema: { x: Types.f32, y: Types.f32 } });',
      "const id = 0n;",
      "const read = Position.x[id];",
      "Position.x[id] += 0.5;",
      "const row = 0;",
      "const indexed = Position.x[row];",
      "void read;",
      "void indexed;",
      "",
    ].join("\n");
    const readConfig = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(readConfig.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(readConfig.config, ts.sys, dirname(configPath));
    // `types: []` drops the ambient node and vitest packages (306 -> 121 program files). The
    // probe and the sources it imports use neither: tsc reports the same diagnostics either way.
    const options = { ...parsed.options, types: [] };
    const host = ts.createCompilerHost(options);
    const fileExists = host.fileExists.bind(host);
    const readFile = host.readFile.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);
    host.fileExists = (file) => file === probeName || fileExists(file);
    host.readFile = (file) => (file === probeName ? probeSource : readFile(file));
    host.getSourceFile = (file, languageVersion, onError, shouldCreateSourceFile) => {
      if (file === probeName) {
        return ts.createSourceFile(file, probeSource, languageVersion, true);
      }
      return getSourceFile(file, languageVersion, onError, shouldCreateSourceFile);
    };
    const program = ts.createProgram({
      rootNames: [probeName],
      options,
      host,
    });
    const probeFile = program.getSourceFile(probeName);
    expect(probeFile).toBeDefined();
    // Check the probe file only: getPreEmitDiagnostics checks every program file, then the
    // probe's diagnostics were the only ones kept. Same result, about a quarter of the time.
    const diagnostics = [
      ...program.getSyntacticDiagnostics(probeFile),
      ...program.getSemanticDiagnostics(probeFile),
    ];
    // Exactly the three TS2339 lines: an unresolved import or a missing type also fails here.
    const found = diagnostics.map((diagnostic) => [
      diagnostic.code,
      diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line ?? -1,
    ]);
    expect(found).toEqual([
      [2339, 3],
      [2339, 4],
      [2339, 6],
    ]);
  });
});
