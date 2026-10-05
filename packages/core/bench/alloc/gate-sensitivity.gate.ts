import { expect, test } from "vitest";

import thresholdsFile from "../alloc-thresholds.json" with { type: "json" };
import {
  evaluateAllocGate,
  formatAllocFailure,
  formatAllocNumber,
  parseAllocThresholds,
} from "./evaluate-alloc-gate";
import { readAllocSink } from "./scenarios";
import { measurePath, runningNodeMajor } from "./run-path";

const thresholds = parseAllocThresholds(thresholdsFile);

test("one object per entity in update.system fails the slope gate", async () => {
  const nodeMajor = runningNodeMajor();
  const row = await measurePath("update.system", thresholds, { extraObject: true });
  // eslint-disable-next-line no-console -- the gate prints the sensitivity sample
  console.log(`[ALLOC SAMPLE] ${JSON.stringify(row)}`);
  const report = evaluateAllocGate([row], thresholds, nodeMajor);
  // eslint-disable-next-line no-console -- the gate prints the failure line
  console.log(`[ALLOC REPORT] ${JSON.stringify(report)}`);
  expect(readAllocSink()).toEqual(expect.any(Number));
  expect(report.verdict).toBe("fail");

  const failure = report.failures.find(
    (item) => item.path === "update.system" && item.metric === "bytesPerEntityFrame",
  );
  expect(failure).toBeDefined();
  const line = formatAllocFailure(failure!, thresholds, nodeMajor);
  expect(report.messages).toContain(line);
  expect(line).toContain("update.system");
  expect(line).toContain("bytesPerEntityFrame");
  expect(line).toContain(String(failure!.recorded));
  expect(line).toContain(formatAllocNumber(failure!.measured));
});
