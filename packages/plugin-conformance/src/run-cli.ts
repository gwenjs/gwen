const SKELETON_SUMMARY = "CONFORMANCE: 0 findings (0 checks)\n";

export interface CliIo {
  readonly cwd: string;
  readonly stdout: { write(chunk: string): void };
  readonly stderr: { write(chunk: string): void };
}

const PROFILES = new Set(["plugin", "package"]);

function classify(argv: readonly string[]): "check" | "usage" {
  const command = argv[0];
  if (command !== "check") return "usage";
  let seenProfile = false;
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== "--profile") return "usage";
    if (seenProfile) return "usage";
    seenProfile = true;
    const value = argv[index + 1];
    if (value === undefined || !PROFILES.has(value)) return "usage";
    index += 1;
  }
  return "check";
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  // Unknown options stay on this summary so the usage test is red until the checks exist.
  if (classify(argv) === "usage") {
    io.stdout.write(SKELETON_SUMMARY);
    return 0;
  }
  io.stdout.write(SKELETON_SUMMARY);
  return 0;
}
