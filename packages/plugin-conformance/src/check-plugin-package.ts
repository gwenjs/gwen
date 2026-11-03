import { CONFORMANCE_CHECK_IDS } from "./check-ids.js";
import { checkExports } from "./check-exports.js";
import { checkHooks } from "./check-hooks.js";
import { checkManifest } from "./check-manifest.js";
import { ConformanceErrorCodes } from "./error-codes.js";
import { packageReadFinding } from "./manifest-finding.js";
import type { PackageContext } from "./package-context.js";
import { readPackageJson } from "./read-package.js";
import { snapshotFindings } from "./snapshot.js";
import { compareFindings } from "./sort-findings.js";
import type {
  CheckPluginPackageOptions,
  ConformanceCheckId,
  ConformanceFinding,
  ConformanceReport,
} from "./types.js";

type FindingsById = Partial<Record<ConformanceCheckId, readonly ConformanceFinding[]>>;

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
 * `package.json` is read once. The snapshot checks run only when `exports` has no finding. When it
 * is missing or not JSON, only the manifest check is reported.
 * An unknown `profile` (from a JS caller) is one `INVALID_SPEC` finding, not a throw. A `src` file
 * that cannot be read (any error but a missing file) rejects with that error: a silent pass would
 * hide a violation.
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
  const [exportsFindings, hooksFindings, manifestFindings] = await Promise.all([
    checkExports(context),
    checkHooks(context),
    checkManifest(context),
  ]);
  const byId: FindingsById = {
    exports: exportsFindings,
    hooks: hooksFindings,
    manifest: manifestFindings,
  };
  // A missing target already is an `exports` finding; the snapshot checks would repeat it.
  if (exportsFindings.length === 0) {
    const snapshot = await snapshotFindings(context);
    byId["snapshot-values"] = snapshot.values;
    byId["snapshot-types"] = snapshot.types;
  }
  const checks = CONFORMANCE_CHECK_IDS.filter((id) => byId[id] !== undefined);
  const findings = checks.flatMap((id) => byId[id] ?? []).sort(compareFindings);
  return { checks, findings };
}
