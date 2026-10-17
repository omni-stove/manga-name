import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-vitest'],
  // iframe のチャンクは Storybook 本体を抱えて 1MB を超えるが、配布物ではないので大きさは問わない
  viteFinal: (config) => ({
    ...config,
    build: { ...config.build, chunkSizeWarningLimit: Number.POSITIVE_INFINITY },
  }),
}

export default config
