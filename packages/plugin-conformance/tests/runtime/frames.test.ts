import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createViewportsPlugin } from "@gwenjs/app";
import { CameraCorePlugin } from "@gwenjs/camera-core";
import { ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import { runPluginConformance } from "@gwenjs/plugin-conformance/runtime";
import { seedChunk } from "../fixtures/runtime/chunk-on-update/src/index.js";
import { seedEach } from "../fixtures/runtime/each-on-update/src/index.js";
import { withPrivateTmpdir } from "../helpers/fixture.js";
import {
  factorySource,
  findingsWithCode,
  ranChecks,
  spec,
  writePluginPackage,
} from "../helpers/runtime.js";

const eachRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime/each-on-update",
);

const chunkRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime/chunk-on-update",
);

const emptyRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime/empty-on-update",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const secondFrameSource = `export function Plugin() {
  return {
    name: "second-frame",
    setup(engine) {
      let seen = 0;
      engine.hooks.hook("engine:update", () => {
        seen += 1;
        if (seen === 2) {
          engine.errors.emit({
            level: "warning",
            code: "FIXTURE:SECOND",
            message: "second-frame",
          });
        }
      });
    },
  };
}
`;

const thirdFrameSource = `export function Plugin() {
  return {
    name: "third-frame",
    setup(engine) {
      let seen = 0;
      engine.hooks.hook("engine:update", () => {
        seen += 1;
        if (seen === 3) {
          engine.errors.emit({
            level: "warning",
            code: "FIXTURE:THIRD",
            message: "third-frame",
          });
        }
      });
    },
  };
}
`;

const loggerWarnSource = `export function Plugin() {
  return {
    name: "logger-warn",
    setup(engine) {
      engine.inject("logger").warn("dev-warn");
    },
  };
}
`;

describe("runPluginConformance frames", () => {
  it("rejects frames 0 with CONFORMANCE:INVALID_SPEC", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/plugin",
        files: { "dist/index.js": factorySource("Plugin") },
      });

      for (const frames of [0, 1.5, -1]) {
        const report = await runPluginConformance(spec({ root: dir, frames }));
        const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
        expect(report.checks).toEqual([]);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.message).toBe("frames must be an integer greater than or equal to 1");
      }
    });
  });

  it("reports a warning event emitted on the second frame", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/second-frame",
        files: { "dist/index.js": secondFrameSource },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/second-frame" }),
      );
      expect(report.findings.map((finding) => finding.code)).toEqual([
        ConformanceErrorCodes.RUNTIME_FRAME_EVENT,
      ]);
      expect(report.findings[0]?.message).toContain("frame 2");
      expect(report.findings[0]?.message).toContain("FIXTURE:SECOND");
    });
  });

  it("reports a logger warn entry", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/logger-warn",
        files: { "dist/index.js": loggerWarnSource },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/logger-warn" }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_DEV_WARNING);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("dev-warn");
    });
  });

  it("reports each() in onUpdate with api Query.each and phase engine:update", async () => {
    const report = await runPluginConformance(
      spec({
        root: eachRoot,
        packageName: "@fixture/each-on-update",
        factories: [{ export: "EachSystem" }],
        fixture(engine) {
          seedEach(engine);
        },
      }),
    );
    expect(report.findings.map((finding) => finding.code)).toEqual([
      ConformanceErrorCodes.RUNTIME_PER_ENTITY_PATH,
    ]);
    expect(report.findings[0]?.message).toContain("Query.each");
    expect(report.findings[0]?.message).toContain("engine:update");
  });

  it("accepts the chunk-form fixture", async () => {
    const report = await runPluginConformance(
      spec({
        root: chunkRoot,
        packageName: "@fixture/chunk-on-update",
        factories: [{ export: "ChunkSystem" }],
        fixture(engine) {
          seedChunk(engine);
        },
      }),
    );
    expect(report.checks).toEqual(ranChecks());
    expect(report.findings).toEqual([]);
  });

  it("runs 3 frames by default and honours frames 2", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/third-frame",
        files: { "dist/index.js": thirdFrameSource },
      });

      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/third-frame" }),
      );
      const findings = findingsWithCode(report, ConformanceErrorCodes.RUNTIME_FRAME_EVENT);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("frame 3");
      expect(findings[0]?.message).toContain("FIXTURE:THIRD");

      const limited = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/third-frame", frames: 2 }),
      );
      expect(findingsWithCode(limited, ConformanceErrorCodes.RUNTIME_FRAME_EVENT)).toEqual([]);
      expect(limited.checks).toEqual(ranChecks());
    });
  });

  it("reports a fixture that throws as CONFORMANCE:INVALID_SPEC", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/boom",
        files: { "dist/index.js": factorySource("Plugin") },
      });

      const thrown = spec({
        root: dir,
        packageName: "@fixture/boom",
        fixture() {
          throw new Error("boom");
        },
      });
      const report = await runPluginConformance(thrown);
      const findings = findingsWithCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("boom");

      const again = await runPluginConformance(thrown);
      const againFindings = findingsWithCode(again, ConformanceErrorCodes.INVALID_SPEC);
      expect(againFindings).toHaveLength(1);
      expect(againFindings[0]?.message).toContain("boom");
    });
  });

  it("reports an error event emitted during the frames", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/error-frame",
        files: {
          "dist/index.js": `export function Plugin() {
  return {
    name: "error-frame",
    setup(engine) {
      let seen = 0;
      engine.hooks.hook("engine:update", () => {
        seen += 1;
        if (seen !== 1) return;
        engine.errors.emit({ level: "error", code: "FIXTURE:ERROR", message: "error-event" });
      });
    },
  };
}
`,
        },
      });
      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/error-frame" }),
      );
      expect(report.findings.map((finding) => finding.code)).toEqual([
        ConformanceErrorCodes.RUNTIME_FRAME_EVENT,
      ]);
      expect(report.findings[0]?.message).toContain("FIXTURE:ERROR");
    });
  });

  it("reports a fatal event as RUNTIME_FRAME_EVENT without throwing", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/fatal-frame",
        files: {
          "dist/index.js": `export function Plugin() {
  return {
    name: "fatal-frame",
    setup(engine) {
      let seen = 0;
      engine.hooks.hook("engine:update", () => {
        seen += 1;
        if (seen !== 1) return;
        engine.errors.emit({ level: "fatal", code: "FIXTURE:FATAL", message: "fatal-event" });
      });
    },
  };
}
`,
        },
      });
      await expect(
        runPluginConformance(spec({ root: dir, packageName: "@fixture/fatal-frame" })),
      ).resolves.toEqual(
        expect.objectContaining({
          findings: [
            expect.objectContaining({
              code: ConformanceErrorCodes.RUNTIME_FRAME_EVENT,
              message: expect.stringContaining("FIXTURE:FATAL"),
            }),
          ],
        }),
      );
    });
  });

  it("ignores info events and info log entries", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/info-frame",
        files: {
          "dist/index.js": `export function Plugin() {
  return {
    name: "info-frame",
    setup(engine) {
      engine.errors.emit({ level: "info", code: "FIXTURE:INFO", message: "info-event" });
      engine.inject("logger").info("info-log");
    },
  };
}
`,
        },
      });
      const report = await runPluginConformance(
        spec({ root: dir, packageName: "@fixture/info-frame" }),
      );
      expect(report.findings).toEqual([]);
    });
  });

  it("runs the fixture before the first frame", async () => {
    const href = pathToFileURL(path.join(emptyRoot, "dist/index.js")).href;
    const loaded: unknown = await import(href);
    const seedRows = isRecord(loaded) ? loaded.seedRows : undefined;
    expect(typeof seedRows).toBe("function");
    if (typeof seedRows !== "function") return;
    const report = await runPluginConformance(
      spec({
        root: emptyRoot,
        packageName: "@fixture/empty-on-update",
        factories: [{ export: "EmptySystem" }],
        fixture(engine) {
          seedRows(engine);
        },
      }),
    );
    expect(report.findings).toEqual([]);
  });

  it("installs frameworkProviders before the plugin", async () => {
    await withPrivateTmpdir(async (dir) => {
      await writePluginPackage(dir, {
        name: "@fixture/camera-frame",
        files: {
          "dist/index.js": `export function Plugin() {
  return {
    name: "camera-frame",
    requires: { plugins: ["camera-core"] },
    setup(engine) {
      let seen = 0;
      engine.hooks.hook("engine:update", () => {
        seen += 1;
        if (seen !== 1) return;
        engine.errors.emit({ level: "warning", code: "FIXTURE:FRAME", message: "frame-one" });
      });
    },
  };
}
`,
        },
      });
      const report = await runPluginConformance(
        spec({
          root: dir,
          packageName: "@fixture/camera-frame",
          frameworkProviders: [createViewportsPlugin, CameraCorePlugin],
        }),
      );
      expect(report.findings.map((finding) => finding.code)).toEqual([
        ConformanceErrorCodes.RUNTIME_FRAME_EVENT,
      ]);
    });
  });
});
