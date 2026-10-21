---
title: Browser support
description: The Content Security Policy a page needs to load the GWEN WASM core.
---

# Browser support

## Content Security Policy

The minimum policy for a page that loads the GWEN core is:

```
Content-Security-Policy: script-src 'self' 'wasm-unsafe-eval'
```

Compiling any WebAssembly module needs `'wasm-unsafe-eval'`.

The glue file loads with `import()`. Serve that file from the page's own origin, or add the glue's origin to `script-src`. A policy that allowed `blob:` and did not name the glue's origin must name that origin. `blob:` is not required.

The loader does not build a script from the glue URL. A fragment on `jsUrl` is not executed as code.
