import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { CLOUD_API_ORIGIN } from './tests/cloud'

const PORT = 4173
const COLLAB_PORT = 4174
const CLOUD_PORT = 4175
const CI = Boolean(process.env.CI)
// 開発用の wrangler dev の D1 と R2 に e2e のユーザーとプロジェクトを混ぜない
const WRANGLER_STATE = fileURLToPath(new URL('.wrangler', import.meta.url))
const wrangler = (args: string) =>
  `pnpm --filter @manga/api exec wrangler ${args} --persist-to "${WRANGLER_STATE}"`

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
      testIgnore: ['**/collab-*.e2e.ts', '**/cloud-*.e2e.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // シナリオ 1, 2, 3 と同時編集を、同じブラウザのタブ同士で共同編集するビルドで通す
      name: 'collab',
      testIgnore: '**/cloud-*.e2e.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${COLLAB_PORT}` },
    },
    {
      // シナリオ 7 を、workers/api につなぐビルドで通す
      name: 'cloud',
      testMatch: '**/cloud-*.e2e.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${CLOUD_PORT}` },
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
      // ビルドが並んで走るので、出力先を分けて互いの dist を消さないようにする
      command: `pnpm --filter @manga/web exec vite build --outDir dist-collab && pnpm --filter @manga/web exec vite preview --outDir dist-collab --port ${COLLAB_PORT} --strictPort`,
      env: { VITE_COLLAB_TABS: '1' },
      url: `http://localhost:${COLLAB_PORT}`,
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
    {
      command: `pnpm --filter @manga/web exec vite build --outDir dist-cloud && pnpm --filter @manga/web exec vite preview --outDir dist-cloud --port ${CLOUD_PORT} --strictPort`,
      env: { VITE_API_BASE_URL: CLOUD_API_ORIGIN },
      url: `http://localhost:${CLOUD_PORT}`,
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
    {
      // development にするのは X-Debug-User を開くため。Google のログインは通せないので、テストがその往復だけを置き換えて
      // X-Debug-User でユーザーを名乗る（tests/cloud.ts）。秘密はこのローカルの Worker の中でしか使わない値
      command: [
        wrangler('d1 migrations apply manga-api --local'),
        wrangler(
          [
            `dev --port ${new URL(CLOUD_API_ORIGIN).port}`,
            '--var ENVIRONMENT:development',
            `--var WEB_ORIGINS:http://localhost:${CLOUD_PORT}`,
            '--var BETTER_AUTH_SECRET:e2e-better-auth-secret-0123456789abcdef',
            '--var ASSET_URL_SECRET:e2e-asset-url-secret-0123456789abcdef',
          ].join(' '),
        ),
      ].join(' && '),
      env: { WRANGLER_SEND_METRICS: 'false' },
      url: `${CLOUD_API_ORIGIN}/v1/health`,
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
  ],
})
