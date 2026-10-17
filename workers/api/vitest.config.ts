import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// workers/api の型は Workers の実行環境に合わせて Node の型を入れていないので、process は型を付けて取り出す
const processEnv =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

export default defineConfig(async () => {
  const migrations = await readD1Migrations(new URL('./migrations', import.meta.url).pathname)
  const anthropicApiKey = processEnv.ANTHROPIC_API_KEY
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            ENVIRONMENT: 'development',
            BETTER_AUTH_SECRET: 'test-better-auth-secret-0123456789abcdef',
            ASSET_URL_SECRET: 'test-asset-secret',
            TEST_MIGRATIONS: migrations,
            // 実 LLM のテストは 1 回ごとに課金されるので、シェルで渡したときだけ走らせる。
            // ANTHROPIC_API_KEY と別名にするのは、.dev.vars のキーで普段のテストから課金されないようにするため
            ...(anthropicApiKey ? { TEST_ANTHROPIC_API_KEY: anthropicApiKey } : {}),
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  }
})
