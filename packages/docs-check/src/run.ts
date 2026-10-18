export interface RunHooks {
  onDisposed?: (state: string) => void;
}

/** Stub: the block is not run and the engine is not stopped. */
export async function runSnippet(
  _code: string,
  _file: string,
  _line: number,
  hooks?: RunHooks,
): Promise<void> {
  hooks?.onDisposed?.("idle");
}
