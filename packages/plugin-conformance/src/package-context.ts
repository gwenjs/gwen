import type { CheckPluginPackageOptions } from "./types.js";

/** The single `package.json` read shared by every check. */
export interface PackageContext {
  readonly root: string;
  readonly profile: CheckPluginPackageOptions["profile"];
  readonly text: string;
  readonly manifest: unknown;
}
