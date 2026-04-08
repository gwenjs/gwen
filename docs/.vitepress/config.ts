import { defineConfig } from 'vitepress'

const enSidebar = [
  {
    text: 'Getting Started',
    items: [
      { text: 'What is GWEN?', link: '/guide/what-is-gwen' },
      { text: 'Quick Start', link: '/guide/quick-start' },
      { text: 'Installation', link: '/guide/installation' },
      { text: 'Project Structure', link: '/guide/project-structure' },
    ],
  },
  {
    text: 'Essentials',
    items: [
      { text: 'Architecture', link: '/essentials/architecture' },
      { text: 'The Engine', link: '/essentials/engine' },
      { text: 'Components', link: '/essentials/components' },
      { text: 'Systems', link: '/essentials/systems' },
      { text: 'Actors', link: '/essentials/actors' },
      { text: 'Prefabs', link: '/essentials/prefabs' },
      { text: 'Scenes', link: '/essentials/scenes' },
      { text: 'Scene Router', link: '/essentials/scene-router' },
      { text: 'Layouts', link: '/essentials/layouts' },
    ],
  },
  {
    text: 'Going Further',
    items: [
      { text: 'Hooks & Events', link: '/advanced/hooks' },
      { text: 'Tween & Animation', link: '/advanced/tween' },
      { text: 'Error Bus', link: '/advanced/error-bus' },
      { text: 'Debug Mode', link: '/advanced/debug-mode' },
      { text: 'Extending Vite', link: '/advanced/vite-config' },
    ],
  },
  {
    text: 'Physics',
    items: [
      { text: 'Physics 2D Composables', link: '/physics/physics2d-composables' },
      { text: 'Physics 3D Composables', link: '/physics/physics3d-composables' },
    ],
  },
  {
    text: 'Kit — Extending GWEN',
    items: [
      { text: 'Plugin System', link: '/kit/overview' },
      { text: 'Writing a Custom Plugin', link: '/kit/custom-plugin' },
      { text: 'Writing a Custom Module', link: '/kit/custom-module' },
      { text: 'Writing a Custom Renderer', link: '/kit/custom-renderer' },
      { text: 'Composing Plugins', link: '/kit/composing' },
    ],
  },
  {
    text: 'API Reference',
    items: [
      { text: '@gwenjs/core', link: '/api/core' },
      { text: '@gwenjs/app', link: '/api/app' },
      { text: '@gwenjs/kit', link: '/api/kit' },
      { text: '@gwenjs/math', link: '/api/math' },
      { text: '@gwenjs/schema', link: '/api/schema' },
      { text: '@gwenjs/physics2d', link: '/api/physics2d' },
      { text: '@gwenjs/physics3d', link: '/api/physics3d' },
      { text: '@gwenjs/physics3d-fracture', link: '/api/physics3d-fracture' },
      { text: '@gwenjs/renderer-core', link: '/api/renderer-core' },
      { text: '@gwenjs/vite', link: '/api/vite' },
    ],
  },
]

const frSidebar = [
  {
    text: 'Démarrage',
    items: [
      { text: "Qu'est-ce que GWEN ?", link: '/fr/guide/what-is-gwen' },
      { text: 'Démarrage rapide', link: '/fr/guide/quick-start' },
      { text: 'Installation', link: '/fr/guide/installation' },
      { text: 'Structure du projet', link: '/fr/guide/project-structure' },
    ],
  },
  {
    text: 'Fondamentaux',
    items: [
      { text: 'Architecture', link: '/fr/essentials/architecture' },
      { text: 'Le moteur', link: '/fr/essentials/engine' },
      { text: 'Composants', link: '/fr/essentials/components' },
      { text: 'Systèmes', link: '/fr/essentials/systems' },
      { text: 'Acteurs', link: '/fr/essentials/actors' },
      { text: 'Prefabs', link: '/fr/essentials/prefabs' },
      { text: 'Scènes', link: '/fr/essentials/scenes' },
      { text: 'Routeur de scènes', link: '/fr/essentials/scene-router' },
      { text: 'Layouts', link: '/fr/essentials/layouts' },
    ],
  },
  {
    text: 'Aller plus loin',
    items: [
      { text: 'Hooks et événements', link: '/fr/advanced/hooks' },
      { text: 'Tween & Animation', link: '/fr/advanced/tween' },
      { text: "Bus d'erreurs", link: '/fr/advanced/error-bus' },
      { text: 'Mode debug', link: '/fr/advanced/debug-mode' },
      { text: 'Étendre Vite', link: '/fr/advanced/vite-config' },
    ],
  },
  {
    text: 'Physique',
    items: [
      { text: 'Composables Physics 2D', link: '/fr/physics/physics2d-composables' },
      { text: 'Composables Physics 3D', link: '/fr/physics/physics3d-composables' },
    ],
  },
  {
    text: 'Kit — Étendre GWEN',
    items: [
      { text: 'Système de plugins', link: '/fr/kit/overview' },
      { text: 'Créer un plugin', link: '/fr/kit/custom-plugin' },
      { text: 'Créer un module', link: '/fr/kit/custom-module' },
      { text: 'Créer un renderer', link: '/fr/kit/custom-renderer' },
      { text: 'Composer des plugins', link: '/fr/kit/composing' },
    ],
  },
  {
    text: 'Référence API',
    items: [
      { text: '@gwenjs/core', link: '/fr/api/core' },
      { text: '@gwenjs/app', link: '/fr/api/app' },
      { text: '@gwenjs/kit', link: '/fr/api/kit' },
      { text: '@gwenjs/math', link: '/fr/api/math' },
      { text: '@gwenjs/schema', link: '/fr/api/schema' },
      { text: '@gwenjs/physics2d', link: '/fr/api/physics2d' },
      { text: '@gwenjs/physics3d', link: '/fr/api/physics3d' },
      { text: '@gwenjs/physics3d-fracture', link: '/fr/api/physics3d-fracture' },
      { text: '@gwenjs/renderer-core', link: '/fr/api/renderer-core' },
      { text: '@gwenjs/vite', link: '/fr/api/vite' },
    ],
  },
]

export default defineConfig({
  base: '/gwen/',
  cleanUrls: true,
  ignoreDeadLinks: [],

  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      title: 'GWEN',
      description: 'Composable web game engine — TypeScript DX, Rust/WASM performance.',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/what-is-gwen' },
          { text: 'API', link: '/api/core' },
        ],
        sidebar: enSidebar,
      },
    },
    fr: {
      label: 'Français',
      lang: 'fr-FR',
      title: 'GWEN',
      description: 'Moteur de jeu web composable — DX TypeScript, performance Rust/WASM.',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/fr/guide/what-is-gwen' },
          { text: 'API', link: '/fr/api/core' },
        ],
        sidebar: frSidebar,
      },
    },
  },

  themeConfig: {
    outline: 'deep',
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/gwenjs/gwen' },
    ],
  },
})
