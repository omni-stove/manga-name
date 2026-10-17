import { type BrowserContext, expect, type Page, type Request } from '@playwright/test'

/** プロジェクト `cloud` の apps/web がつなぐ workers/api（wrangler dev）のオリジン */
export const CLOUD_API_ORIGIN = 'http://localhost:8789'

/** e2e ごとに別のユーザー。同じユーザーの 2 つのブラウザだけが同じプロジェクトを見る */
export const uniqueUser = (): string =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`

const corsHeaders = (request: Request) => ({
  'access-control-allow-origin': request.headers().origin ?? '*',
  'access-control-allow-credentials': 'true',
  'access-control-expose-headers': 'set-auth-token',
})

/**
 * context のブラウザで、Google のログインを済ませたものとして email のユーザーになる。
 * Better Auth の `/v1/auth/*` だけをここで答え、それ以外の API は wrangler dev にそのまま送る。
 * wrangler dev は ENVIRONMENT=development なので、Bearer の代わりに X-Debug-User でユーザーを決める。
 * Google の OAuth はテストから通せないので、置き換えるのはその往復だけにする
 */
export async function fakeGoogleAccount(context: BrowserContext, email: string): Promise<void> {
  let signedIn = false
  await context.route(`${CLOUD_API_ORIGIN}/v1/**`, async (route, request) => {
    const { pathname } = new URL(request.url())
    if (pathname === '/v1/auth/sign-in/social') {
      signedIn = true
      // Google から callbackURL に戻ってきたことにする
      const { callbackURL } = request.postDataJSON() as { callbackURL: string }
      return route.fulfill({ headers: corsHeaders(request), json: { url: callbackURL } })
    }
    if (pathname === '/v1/auth/get-session') {
      return route.fulfill({
        headers: corsHeaders(request),
        json: signedIn
          ? {
              session: {
                token: `token-${email}`,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              },
              user: { id: email, name: email.split('@')[0], email, image: null },
            }
          : null,
      })
    }
    if (pathname === '/v1/auth/sign-out') {
      signedIn = false
      return route.fulfill({ headers: corsHeaders(request), json: { success: true } })
    }
    return route.continue({ headers: { ...(await request.allHeaders()), 'x-debug-user': email } })
  })
}

/** アプリ設定のログインからログインし、ヘッダーにサインアウトが出るまで待つ */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page.getByRole('banner').getByRole('button', { name: 'サインアウト' })).toBeVisible()
}

/** エディタのツールバーの同期状態が「同期済み」になるまで待つ */
export async function waitSynced(page: Page): Promise<void> {
  await expect(page.getByText('同期済み', { exact: true })).toBeVisible({ timeout: 30_000 })
}
