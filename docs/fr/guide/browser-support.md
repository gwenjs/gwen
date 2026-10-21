---
title: Support navigateur
description: La politique de sécurité de contenu dont une page a besoin pour charger le cœur WASM de GWEN.
---

# Support navigateur

## Content Security Policy

La politique minimale pour une page qui charge le cœur GWEN est :

```
Content-Security-Policy: script-src 'self' 'wasm-unsafe-eval'
```

Compiler un module WebAssembly exige `'wasm-unsafe-eval'`.

Le fichier de glue se charge avec `import()`. Servez ce fichier depuis l'origine de la page, ou ajoutez l'origine de la glue à `script-src`. Une politique qui autorisait `blob:` sans nommer l'origine de la glue doit nommer cette origine. `blob:` n'est pas requis.

Le chargeur ne construit pas de script à partir de l'URL de la glue. Un fragment sur `jsUrl` n'est pas exécuté comme du code.
