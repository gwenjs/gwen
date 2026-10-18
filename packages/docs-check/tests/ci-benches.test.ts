import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface CiBench {
  file: string;
  job: string;
  step: string;
}

function readEntries(): CiBench[] {
  const file = path.join(repoRoot, "packages/docs-check/ci-benches.json");
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is CiBench => {
    if (typeof entry !== "object" || entry === null) return false;
    const row = entry as Record<string, unknown>;
    return typeof row.file === "string" && typeof row.job === "string" && typeof row.step === "string";
  });
}

/** A path suffix of `file` appears in the step `run` string. */
function commandMentionsFile(command: string, file: string): boolean {
  const parts = file.split("/").filter((part) => part.length > 0);
  for (let i = 0; i < parts.length; i += 1) {
    if (command.includes(parts.slice(i).join("/"))) return true;
  }
  return false;
}

function stepCommand(yaml: string, job: string, step: string): string | undefined {
  const lines = yaml.split("\n");
  const jobAt = lines.findIndex((line) => line === `    name: ${job}`);
  if (jobAt < 0) return undefined;
  let jobEnd = lines.length;
  for (let i = jobAt + 1; i < lines.length; i += 1) {
    if (/^  [a-z0-9-]+:/.test(lines[i] ?? "")) {
      jobEnd = i;
      break;
    }
  }
  const stepAt = lines.findIndex(
    (line, index) => index > jobAt && index < jobEnd && line === `      - name: ${step}`,
  );
  if (stepAt < 0) return undefined;
  let stepEnd = jobEnd;
  for (let i = stepAt + 1; i < jobEnd; i += 1) {
    if ((lines[i] ?? "").startsWith("      - name: ")) {
      stepEnd = i;
      break;
    }
  }
  const block = lines.slice(stepAt, stepEnd);
  const runAt = block.findIndex((line) => line.startsWith("        run:"));
  if (runAt < 0) return undefined;
  const first = (block[runAt] ?? "").slice("        run:".length).trim();
  if (first === "|" || first === ">" || first === "|-" || first === ">-") {
    const rest: string[] = [];
    for (let i = runAt + 1; i < block.length; i += 1) {
      const line = block[i] ?? "";
      if (line !== "" && !line.startsWith("          ")) break;
      rest.push(line.trim());
    }
    return rest.join("\n");
  }
  return first;
}

describe("ci bench list", () => {
  it("each ci bench file exists and its step command names it", () => {
    const entries = readEntries();
    expect(entries.length).toBeGreaterThan(0);
    const yaml = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    for (const entry of entries) {
      expect(existsSync(path.join(repoRoot, entry.file)), entry.file).toBe(true);
      const command = stepCommand(yaml, entry.job, entry.step);
      expect(command, `${entry.job} / ${entry.step}`).toBeTruthy();
      expect(commandMentionsFile(command ?? "", entry.file), command).toBe(true);
    }
  });
});
