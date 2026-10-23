/**
 * True for .d.ts, .d.mts, .ts, .tsx, .js and .mjs.
 * @param {string} file
 * @returns {boolean}
 */
export function isModuleEntry(file) {
  return (
    file.endsWith(".d.mts") ||
    file.endsWith(".ts") ||
    file.endsWith(".tsx") ||
    file.endsWith(".js") ||
    file.endsWith(".mjs")
  );
}
