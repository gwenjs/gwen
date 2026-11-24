/** Color numbers for `defineTint`. `red` is 16711680, `green` is 65280, `blue` is 255. */
export const tintRed = 16711680;
export const tintGreen = 65280;
export const tintBlue = 255;

/** Returns the color number for a known name, or 0 for any other string. */
export function defineTint(color: string): number {
  if (color === "red") return tintRed;
  if (color === "green") return tintGreen;
  if (color === "blue") return tintBlue;
  return 0;
}
