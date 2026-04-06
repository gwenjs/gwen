import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'GWEN',
  description: 'Composable Web Game Engine',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'API', link: '/api/' },
    ],
    sidebar: {},
    socialLinks: [
      { icon: 'github', link: 'https://github.com/gwenjs/gwen' },
    ],
  },
})
