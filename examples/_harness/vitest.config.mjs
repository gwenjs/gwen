// `testTimeout`: the `tsc` cases run a full type-check of an example, which takes about 5 s on a CI runner.
export default {
  test: { environment: "node", include: ["e2e/build-output.spec.ts"], testTimeout: 60_000 },
};
