import gwen from './scripts/commitlint-gwen.mjs';

const config = {
  extends: ['@commitlint/config-conventional'],
  plugins: [gwen],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'app',
        'camera-core',
        'core',
        'kit',
        'math',
        'physics2d',
        'physics3d',
        'renderer-core',
        'schema',
        'vite',
        'deps',
        'ci',
        'release',
        'docs',
      ],
    ],
    'gwen-no-attribution': [2, 'always'],
    'gwen-breaking-footer': [2, 'always'],
  },
};

export default config;
