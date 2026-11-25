/**
 * @file Framework providers the build installs on demand (Node.js only).
 *
 * Imported by `GwenApp` behind `@gwenjs/app/resolve`. The browser entry never reaches this file.
 * Strings only: this file does not import the packages it names.
 */

import type { PluginDeclaration } from "@gwenjs/schema";

/**
 * Rows by plugin name and by service key. A row is the declaration the build inserts.
 * A row carries no `requires`: the build does not resolve an inserted row.
 */
export interface FrameworkProviderTable {
  readonly plugins: Readonly<Record<string, PluginDeclaration>>;
  /** A row here declares `provides` with its own key, so a second consumer finds it installed. */
  readonly services: Readonly<Record<string, PluginDeclaration>>;
}

/**
 * Providers installed only when a declaration requires them. The bootstrap's fixed
 * plugins (`gwen:viewports`, `gwen:screen`) are not rows.
 */
export const FRAMEWORK_PROVIDERS = {
  plugins: { "camera-core": { src: "@gwenjs/camera-core", export: "CameraCorePlugin" } },
  services: {},
} as const satisfies FrameworkProviderTable;
