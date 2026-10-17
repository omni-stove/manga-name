import { defineConfig } from '@playwright/test'

const CI = Boolean(process.env.CI)

// Playwright はランナーと report にだけ使い、アプリは desktop/tauri.ts が tauri-driver で動かす
export default defineConfig({
  testDir: 'desktop',
  testMatch: '**/*.e2e.ts',
  // tauri-driver のポートとウィンドウのフォーカスは 1 つしか持てない
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 120_000,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
})
