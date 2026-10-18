import type { Fence } from "./fences.js";

export interface SnippetFailure {
  file: string;
  line: number;
  message: string;
}

/** Stub: every fence is reported, so the checks fail until the compiler is wired. */
export function checkFence(fence: Fence): SnippetFailure | null {
  return { file: fence.file, line: fence.line, message: "unchecked" };
}

export function checkFences(fences: Fence[]): SnippetFailure[] {
  return fences.flatMap((fence) => {
    const failure = checkFence(fence);
    return failure === null ? [] : [failure];
  });
}
