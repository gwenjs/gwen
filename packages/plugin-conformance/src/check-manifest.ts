import { stat } from "node:fs/promises";
import path from "node:path";
import { isRecord } from "./json.js";
import { manifestFinding } from "./manifest-finding.js";
import type { PackageContext } from "./package-context.js";
import type { ConformanceFinding } from "./types.js";

const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt"] as const;

function gwenType(manifest: unknown): unknown {
  if (!isRecord(manifest)) return undefined;
  const gwen = manifest.gwen;
  if (!isRecord(gwen)) return undefined;
  return gwen.type;
}

function hasLicense(manifest: unknown): boolean {
  if (!isRecord(manifest)) return false;
  const license = manifest.license;
  return typeof license === "string" && license.length > 0;
}

async function hasLicenseFile(root: string): Promise<boolean> {
  for (const name of LICENSE_FILES) {
    try {
      const info = await stat(path.join(root, name));
      if (info.isFile()) return true;
    } catch {
      // A missing name is expected; try the next accepted file name.
    }
  }
  return false;
}

/** Manifest rules for `plugin` (includes `gwen.type`) and `package`. */
export async function checkManifest(
  context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  if (context.profile === "plugin" && gwenType(context.manifest) !== "plugin") {
    findings.push(
      manifestFinding('gwen.type must be "plugin"', 'Set gwen.type to "plugin" in package.json.'),
    );
  }
  if (!hasLicense(context.manifest)) {
    findings.push(
      manifestFinding(
        "license must be a non-empty string",
        "Set license to a non-empty SPDX string.",
      ),
    );
  }
  if (!(await hasLicenseFile(context.root))) {
    findings.push(
      manifestFinding(
        "LICENSE file is missing",
        "Add LICENSE, LICENSE.md, or LICENSE.txt at the package root.",
      ),
    );
  }
  return findings;
}
