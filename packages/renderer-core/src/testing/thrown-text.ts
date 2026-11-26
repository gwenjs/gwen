/** Text of a thrown value, with no bracket so the message keeps the error grammar. */
export function thrownText(cause: unknown): string {
  const text =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "a value that is not an Error";
  return text.replaceAll("[", "(").replaceAll("]", ")");
}
