import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(new URL('./migrations', import.meta.url).pathname)
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { APP_ACCESS_TOKEN: 'test-token', TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  }
})
