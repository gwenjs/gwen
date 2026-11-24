import { FRAMEWORK_ENTRIES } from "./framework-entries.generated.js";

/** `@gwenjs/<name>` of a framework entry specifier. */
function packageOfEntry(entry: string): string {
  return entry.split("/").slice(0, 2).join("/");
}

/** Packages that own a framework entry. Derived from `FRAMEWORK_ENTRIES`, not listed by hand. */
export const FRAMEWORK_PACKAGES: ReadonlySet<string> = new Set(
  Object.keys(FRAMEWORK_ENTRIES).map(packageOfEntry),
);
