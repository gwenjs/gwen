The `pass-arm64` and `pass-x64` numbers are shapes for the judge tests, not x86-64 measurements.
`unl-default` comes from an arm64 Docker run. `ul*-default` comes from a Rosetta-emulated run.
Sources are `/tmp/verify-node/*.txt` (`arm64-light.txt`, `amd64-light.txt`).
Real x64 numbers come from the first CI run recorded in the PR.
