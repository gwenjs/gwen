import { CONFORMANCE_CHECK_IDS } from "./check-ids.js";
import { checkExports } from "./check-exports.js";
import { checkHooks } from "./check-hooks.js";
import { checkManifest } from "./check-manifest.js";
import { ConformanceErrorCodes } from "./error-codes.js";
import { packageReadFinding } from "./manifest-finding.js";
import type { PackageContext } from "./package-context.js";
import { readPackageJson } from "./read-package.js";
import type {
  CheckPluginPackageOptions,
  ConformanceCheckId,
  ConformanceFinding,
  ConformanceReport,
} from "./types.js";

type CheckRun = (context: PackageContext) => Promise<readonly ConformanceFinding[]>;

interface CheckSpec {
  readonly id: ConformanceCheckId;
  readonly run?: CheckRun;
}

/** Implemented runs. Order comes from {@link CONFORMANCE_CHECK_IDS}. */
const CHECK_RUNS: Partial<Record<ConformanceCheckId, CheckRun>> = {
  exports: checkExports,
  hooks: checkHooks,
  manifest: checkManifest,
};

const CHECK_ORDER: readonly CheckSpec[] = CONFORMANCE_CHECK_IDS.map((id) => {
  const run = CHECK_RUNS[id];
  return run === undefined ? { id } : { id, run };
});

function hasRun(entry: CheckSpec): entry is CheckSpec & { readonly run: CheckRun } {
  return entry.run !== undefined;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareFindings(left: ConformanceFinding, right: ConformanceFinding): number {
  const byFile = compareText(left.file ?? "", right.file ?? "");
  if (byFile !== 0) return byFile;
  const byLine = (left.line ?? 0) - (right.line ?? 0);
  if (byLine !== 0) return byLine;
  const byCode = compareText(left.code, right.code);
  if (byCode !== 0) return byCode;
  return compareText(left.message, right.message);
}

function isProfile(profile: string): profile is CheckPluginPackageOptions["profile"] {
  return profile === "plugin" || profile === "package";
}

function invalidProfileReport(profile: string): ConformanceReport {
  return {
    checks: [],
    findings: [
      {
        code: ConformanceErrorCodes.INVALID_SPEC,
        message: `profile ${JSON.stringify(profile)} is not valid. Allowed values: "plugin", "package"`,
        hint: 'Pass profile "plugin" or "package".',
      },
    ],
  };
}

/**
 * Run the implemented checks for the package at `opts.root`.
 * `package.json` is read once. When it is missing or not JSON, only the manifest check is reported.
 * It never throws: an unknown `profile` (from a JS caller) is one `INVALID_SPEC` finding.
 */
export async function checkPluginPackage(
  opts: CheckPluginPackageOptions,
): Promise<ConformanceReport> {
  if (!isProfile(opts.profile)) return invalidProfileReport(String(opts.profile));
  const loaded = await readPackageJson(opts.root);
  if (!loaded.ok) {
    return { checks: ["manifest"], findings: [packageReadFinding(loaded.reason)] };
  }
  const context: PackageContext = {
    root: opts.root,
    profile: opts.profile,
    text: loaded.text,
    manifest: loaded.manifest,
  };
  const implemented = CHECK_ORDER.filter(hasRun);
  const groups = await Promise.all(implemented.map((entry) => entry.run(context)));
  const findings = groups.flat().sort(compareFindings);
  return { checks: implemented.map((entry) => entry.id), findings };
}
