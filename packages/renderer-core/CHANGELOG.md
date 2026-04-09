# Changelog

## [0.2.0](https://github.com/gwenjs/gwen/compare/renderer-core-v0.1.0...renderer-core-v0.2.0) (2026-04-09)


### Features

* **core:** add defineRendererService factory ([a517857](https://github.com/gwenjs/gwen/commit/a5178574c517237685dc3f6d4c640b7d79bf0198))
* **core:** add getOrCreateLayerManager for transparent logger wiring ([65302c5](https://github.com/gwenjs/gwen/commit/65302c519e7ef8b57d3a0e768bc729ce1302fcac))
* **core:** add RendererService contract and composable handle interfaces ([ec50484](https://github.com/gwenjs/gwen/commit/ec5048442b8bc0bc63e8bf77c577ff6d9f01f65b))
* **core:** add RendererStatsCollector and ring-buffer stats ([43c8428](https://github.com/gwenjs/gwen/commit/43c8428bc08862a55f75261089302a79c41a0988))
* **core:** add runConformanceTests() conformance suite for renderer-core ([8026e1d](https://github.com/gwenjs/gwen/commit/8026e1dd3cf3c19829d5b2ca248e0ffdadfd07c1))
* **core:** build config and workspace integration for renderer-core ([c2c9568](https://github.com/gwenjs/gwen/commit/c2c956874ae6a33b836b1e066708127852a9a9d8))
* **core:** public API exports and EngineStats augmentation for renderer-core ([b3e1431](https://github.com/gwenjs/gwen/commit/b3e1431fc5aad03e73616a6abaf07cb260bac404))
* **core:** public API exports for renderer-core ([7bd5ea6](https://github.com/gwenjs/gwen/commit/7bd5ea6dd302536b4ed94b00895be7e3f2dcfb64))
* **core:** scaffold renderer-core package ([bf2721c](https://github.com/gwenjs/gwen/commit/bf2721c163e1d5513ffc162e4a9a276b145ca129))
* **core:** throw EmptyLayersError in register() when layers is empty ([5bb342e](https://github.com/gwenjs/gwen/commit/5bb342e1a3dcbd07be5929fb7c5182e46b253027))
* **core:** use gwen logger in LayerManager and add renderer-core README ([c4b4a05](https://github.com/gwenjs/gwen/commit/c4b4a05cdf65c8be098728cf6d8656697e96f315))
* **renderer-core:** add extension field to defineRendererService ([0065327](https://github.com/gwenjs/gwen/commit/0065327f7295d990b9166b151d5ca94a24ebd316))


### Bug Fixes

* **core:** add fileName to renderer-core vite config for deterministic output paths ([2c37de9](https://github.com/gwenjs/gwen/commit/2c37de9544d5b22b2f13d2f67e42348821cf4c86))
* **core:** align renderer-core package.json with workspace convention ([2d0f597](https://github.com/gwenjs/gwen/commit/2d0f597076d6bcf2f1b48a491991592fb6e1472d))
* **core:** beginFrame() only resets per-renderer stats, not global totals ([834e2e4](https://github.com/gwenjs/gwen/commit/834e2e470922792a6707bc038b07d5d23825c3a0))
* **core:** detect order conflicts within a single renderer's layers ([2aaaf4f](https://github.com/gwenjs/gwen/commit/2aaaf4fef3ae72af0184bbfd199d840f458f4d0f))
* **core:** remove false EngineStats augmentation for renderer stats ([4cc3cbd](https://github.com/gwenjs/gwen/commit/4cc3cbdc16ea43cfd25ab30e52ede401bf25eaf6))
* **core:** reset per-frame stats totals each tick via LayerManager.beginFrame() ([f43d372](https://github.com/gwenjs/gwen/commit/f43d3727033694a47c69ce84c6bd3274aa225890))
* **core:** store constructor args as public readonly fields on error classes ([1f0d118](https://github.com/gwenjs/gwen/commit/1f0d118698eb08ce5b9ee7b79f3507c604a44972))
* **core:** suppress no-console lint warning on intentional layer conflict warn ([98745f2](https://github.com/gwenjs/gwen/commit/98745f26ce83ace81751d31e16bc9be3ba1f7529))
* **renderer-core:** omit contract keys from TExtension in public return type ([aa89a1b](https://github.com/gwenjs/gwen/commit/aa89a1bb53a789fcf8398b8de0bc6c7e8d3ba3e4))

## 0.1.0 (2026-04-08)

### Features

* **core:** scaffold renderer-core package ([bf2721c](https://github.com/gwenjs/gwen/commit/bf2721c163e1d5513ffc162e4a9a276b145ca129))
* **core:** add RendererService contract and composable handle interfaces ([ec50484](https://github.com/gwenjs/gwen/commit/ec5048442b8bc0bc63e8bf77c577ff6d9f01f65b))
* **core:** add RendererStatsCollector and ring-buffer stats ([43c8428](https://github.com/gwenjs/gwen/commit/43c8428bc08862a55f75261089302a79c41a0988))
* **core:** add runConformanceTests() conformance suite for renderer-core ([8026e1d](https://github.com/gwenjs/gwen/commit/8026e1dd3cf3c19829d5b2ca248e0ffdadfd07c1))
* **core:** public API exports for renderer-core ([7bd5ea6](https://github.com/gwenjs/gwen/commit/7bd5ea6dd302536b4ed94b00895be7e3f2dcfb64))
* **core:** public API exports and EngineStats augmentation for renderer-core ([b3e1431](https://github.com/gwenjs/gwen/commit/b3e1431fc5aad03e73616a6abaf07cb260bac404))
* **core:** build config and workspace integration for renderer-core ([c2c9568](https://github.com/gwenjs/gwen/commit/c2c956874ae6a33b836b1e066708127852a9a9d8))
* **core:** use gwen logger in LayerManager and add renderer-core README ([c4b4a05](https://github.com/gwenjs/gwen/commit/c4b4a05cdf65c8be098728cf6d8656697e96f315))
* **core:** add getOrCreateLayerManager for transparent logger wiring ([65302c5](https://github.com/gwenjs/gwen/commit/65302c519e7ef8b57d3a0e768bc729ce1302fcac))
* **core:** add defineRendererService factory ([a517857](https://github.com/gwenjs/gwen/commit/a5178574c517237685dc3f6d4c640b7d79bf0198))
* **core:** throw EmptyLayersError in register() when layers is empty ([5bb342e](https://github.com/gwenjs/gwen/commit/5bb342e1a3dcbd07be5929fb7c5182e46b253027))

### Bug Fixes

* **core:** store constructor args as public readonly fields on error classes ([1f0d118](https://github.com/gwenjs/gwen/commit/1f0d118698eb08ce5b9ee7b79f3507c604a44972))
* **core:** beginFrame() only resets per-renderer stats, not global totals ([834e2e4](https://github.com/gwenjs/gwen/commit/834e2e470922792a6707bc038b07d5d23825c3a0))
* **core:** suppress no-console lint warning on intentional layer conflict warn ([98745f2](https://github.com/gwenjs/gwen/commit/98745f26ce83ace81751d31e16bc9be3ba1f7529))
* **core:** reset per-frame stats totals each tick via LayerManager.beginFrame() ([f43d372](https://github.com/gwenjs/gwen/commit/f43d3727033694a47c69ce84c6bd3274aa225890))
* **core:** detect order conflicts within a single renderer's layers ([2aaaf4f](https://github.com/gwenjs/gwen/commit/2aaaf4fef3ae72af0184bbfd199d840f458f4d0f))
* **core:** remove false EngineStats augmentation for renderer stats ([4cc3cbd](https://github.com/gwenjs/gwen/commit/4cc3cbdc16ea43cfd25ab30e52ede401bf25eaf6))
* **core:** add fileName to renderer-core vite config for deterministic output paths ([2c37de9](https://github.com/gwenjs/gwen/commit/2c37de9544d5b22b2f13d2f67e42348821cf4c86))
* **core:** align renderer-core package.json with workspace convention ([2d0f597](https://github.com/gwenjs/gwen/commit/2d0f597076d6bcf2f1b48a491991592fb6e1472d))
