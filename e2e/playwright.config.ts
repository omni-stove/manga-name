import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const COLLAB_PORT = 4174
const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: 'tests',
  // ルートの vitest が拾う *.test.ts / *.spec.ts と名前を分ける
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: CI,
  // リトライで通った回は report に flaky として残るので、flaky 率はそこから数える
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/collab-*.e2e.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // シナリオ 1, 2, 3 と同時編集を、同じブラウザのタブ同士で共同編集するビルドで通す
      name: 'collab',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${COLLAB_PORT}` },
    },
  ],
  webServer: [
    {
      // dev サーバは初回アクセスで依存の最適化が走ってページを読み直すことがあるので、ビルドした成果物を配る
      command: `pnpm --filter @manga/web build && pnpm --filter @manga/web preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
    {
      // 2 つのビルドが並んで走るので、出力先を分けて互いの dist を消さないようにする
      command: `pnpm --filter @manga/web exec vite build --outDir dist-collab && pnpm --filter @manga/web exec vite preview --outDir dist-collab --port ${COLLAB_PORT} --strictPort`,
      env: { VITE_COLLAB_TABS: '1' },
      url: `http://localhost:${COLLAB_PORT}`,
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
  ],
})
