/** Ticket order. This list defines `ConformanceCheckId` and the check order. */
export const CONFORMANCE_CHECK_IDS = [
  "exports",
  "snapshot-values",
  "snapshot-types",
  "publint",
  "attw",
  "readme",
  "imports",
  "augment",
  "hooks",
  "test-mocks",
  "peers",
  "manifest",
  "lockfile",
] as const;

export type ConformanceCheckId = (typeof CONFORMANCE_CHECK_IDS)[number];
