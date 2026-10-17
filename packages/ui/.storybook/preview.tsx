import '../src/tokens.css'
import '../src/base.css'
import type { Preview } from '@storybook/react-vite'

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'tokens.css のテーマ',
      toolbar: {
        icon: 'mirror',
        items: [
          { value: 'light', title: 'ライト' },
          { value: 'dark', title: 'ダーク' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    (Story, { globals }) => {
      document.documentElement.dataset.theme = globals.theme
      return <Story />
    },
  ],
}

export default preview
