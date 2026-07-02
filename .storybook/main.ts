import type { StorybookConfig } from '@storybook/nextjs'

const config: StorybookConfig = {
  stories: [
    '../packages/web-ui/src/**/*.stories.@(ts|tsx)',
    '../components/**/*.stories.@(ts|tsx)',
  ],
  addons: [],
  framework: { name: '@storybook/nextjs', options: {} },
  staticDirs: ['../public'],
}

export default config
