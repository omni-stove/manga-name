import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// ルートの vitest.config.ts（node と jsdom）に混ぜないのは、ストーリーは実ブラウザで走らせ、
// 起動に時間がかかるため。CI では E2E と同じく毎晩だけ回す
export default defineConfig({
  plugins: [storybookTest({ configDir: '.storybook' })],
  test: {
    name: 'storybook',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      // 既定の 414×896 だと幅の上限（画面の半分）がサイドバーの既定幅より狭くなる
      instances: [{ browser: 'chromium', viewport: { width: 1280, height: 800 } }],
    },
  },
})
