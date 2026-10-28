import type { StorybookConfig } from '@storybook/nextjs-vite'

const config: StorybookConfig = {
  stories: [
    '../packages/web-ui/src/**/*.stories.@(ts|tsx)',
    '../components/**/*.stories.@(ts|tsx)',
  ],
  // a11y: axe in the Accessibility panel while reviewing a story. CI runs the
  // same checks on every story with the test runner (.storybook/test-runner.ts).
  addons: ['@storybook/addon-a11y'],
  framework: { name: '@storybook/nextjs-vite', options: {} },
  staticDirs: ['../public'],
}

export default config
