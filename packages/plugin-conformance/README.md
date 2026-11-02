# @gwenjs/plugin-conformance

Static checks for a GWEN plugin or package.

## CLI

```bash
gwen-conformance check [--profile plugin|package]
```

The default profile is `plugin`. Each finding is one line `<code> <file>:<line> <message>` (the file and `:<line>` are omitted when absent). The last line is `CONFORMANCE: <n> findings (<k> checks)`. The process returns 0 when `n` is 0, 1 when `n` is greater than 0, and 2 for an unknown command or option.

## Checks

- `exports` — every string target must start with `./` and be a file inside the package. `null` is skipped. A target that is not a string, an array, an object, or `null` is rejected. An empty `exports` object is rejected. Mixing subpath keys and condition keys is rejected. A target that contains `*` is not existence-checked. A target that resolves outside the package is rejected. In a condition object, `types` must be the first key. `./internal`, `./internal/…`, and any key that starts with `./internal*` are rejected in both profiles. Profile `plugin` also requires the `.` and `./module` subpaths. `exports` missing or not an object is rejected.
- `manifest` — profile `plugin` requires `gwen.type` to be `"plugin"`. Both profiles require a non-empty `license` string and a `LICENSE`, `LICENSE.md`, or `LICENSE.txt` file. A missing, unreadable, or invalid `package.json` is one manifest finding, and the exports check does not run.

## API

Exports of `@gwenjs/plugin-conformance`:

- `checkPluginPackage({ root, profile })` runs the implemented checks (`exports`, `manifest`) on the package at `root` and returns a `ConformanceReport`. It never throws. An unknown `profile` (from a JS caller) returns no check and one `CONFORMANCE:INVALID_SPEC` finding that names the value and the allowed ones.
- `ConformanceErrorCodes` holds the codes: `EXPORTS_INVALID`, `MANIFEST`, `INVALID_SPEC`. Each value is prefixed `CONFORMANCE:`.
- `CheckPluginPackageOptions` is the input of `checkPluginPackage`: `root`, `profile` (`plugin` or `package`), and the optional `write` and `lockfileBase`, which are accepted and not used yet.
- `ConformanceCheckId` is the id of a check, in check order.
- `ConformanceCode` is one value of `ConformanceErrorCodes`.
- `ConformanceFinding` is one problem: `code`, `message`, `hint`, and an optional `file` and `line`.
- `ConformanceReport` is the result: `checks` (the checks that ran) and `findings`.
