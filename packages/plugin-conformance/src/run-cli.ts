import { checkPluginPackage } from "./check-plugin-package.js";
import type { ConformanceFinding, ConformanceReport } from "./types.js";

/** Streams and working directory for {@link runCli}. */
export interface CliIo {
  /** Package directory to check. */
  readonly cwd: string;
  /** Finding lines and the summary. */
  readonly stdout: { write(chunk: string): void };
  /** Usage text when the command is rejected. */
  readonly stderr: { write(chunk: string): void };
}

const USAGE = "Usage: gwen-conformance check [--profile plugin|package] [--write]\n";

type Parsed =
  | { readonly kind: "usage" }
  | { readonly kind: "check"; readonly profile: "plugin" | "package"; readonly write: boolean };

function isProfile(value: string | undefined): value is "plugin" | "package" {
  return value === "plugin" || value === "package";
}

function parseArgv(argv: readonly string[]): Parsed {
  if (argv[0] !== "check") return { kind: "usage" };
  let profile: "plugin" | "package" = "plugin";
  let seenProfile = false;
  let write = false;
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--write" && !write) {
      write = true;
      continue;
    }
    if (token !== "--profile" || seenProfile) return { kind: "usage" };
    seenProfile = true;
    const value = argv[index + 1];
    if (!isProfile(value)) return { kind: "usage" };
    profile = value;
    index += 1;
  }
  return { kind: "check", profile, write };
}

function formatFinding(finding: ConformanceFinding): string {
  if (finding.file === undefined) return `${finding.code} ${finding.message}`;
  if (finding.line === undefined) return `${finding.code} ${finding.file} ${finding.message}`;
  return `${finding.code} ${finding.file}:${finding.line} ${finding.message}`;
}

function writeReport(report: ConformanceReport, stdout: CliIo["stdout"]): void {
  for (const finding of report.findings) {
    stdout.write(`${formatFinding(finding)}\n`);
  }
  stdout.write(
    `CONFORMANCE: ${report.findings.length} findings (${report.checks.length} checks)\n`,
  );
}

/**
 * Run `gwen-conformance` for `argv` without the program name.
 * Returns 0 when there is no finding, 1 when there is one, and 2 for an unknown command, an unknown
 * option or a repeated option.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgv(argv);
  if (parsed.kind === "usage") {
    io.stderr.write(USAGE);
    return 2;
  }
  const report = await checkPluginPackage({
    root: io.cwd,
    profile: parsed.profile,
    write: parsed.write,
  });
  writeReport(report, io.stdout);
  return report.findings.length > 0 ? 1 : 0;
}
