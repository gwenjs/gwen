# @gwenjs/plugin-conformance

Static checks for a GWEN plugin or package.

## CLI

```bash
gwen-conformance check [--profile plugin|package]
```

The default profile is `plugin`. Each finding is one line `<code> <file>:<line> <message>`. The last line is `CONFORMANCE: <n> findings (<k> checks)`. The process returns 1 when `n` is greater than 0, and 0 otherwise.

## Checks

- `exports` — every `package.json` `exports` target is a file inside the package, `types` is the first condition, and a plugin exposes `.` and `./module` but not `./internal`.
- `manifest` — a plugin sets `gwen.type` to `"plugin"`. Both profiles require a non-empty `license` and a `LICENSE` file (`LICENSE`, `LICENSE.md`, or `LICENSE.txt`).
