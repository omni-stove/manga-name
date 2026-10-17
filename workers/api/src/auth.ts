import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'
import type { Env } from './env'
import { allowedOrigins } from './origins'

/** Better Auth の口を置くパス */
export const AUTH_BASE_PATH = '/v1/auth'

/**
 * env の D1 にユーザーとセッションを置く Better Auth。ログインは Google OAuth だけで、
 * `POST /v1/auth/sign-in/social` から始める。セッショントークンは応答の `set-auth-token` で渡り、
 * 以降は `Authorization: Bearer <token>` で送る。
 */
function createAuth(env: Env) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: allowedOrigins(env.WEB_ORIGINS),
    // クライアント ID が無くても組み立てるのは、Google の設定が無い wrangler dev でも X-Debug-User で API を通すため
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              // Google の表示名は本名のことが多く、参加者一覧で他のユーザーに見えるので保存しない。
              // 空のまま登録し、Web が表示名を決めさせて PUT /v1/me で入れる
              mapProfileToUser: () => ({ name: '' }),
            },
          }
        : {},
    user: { modelName: 'auth_users' },
    session: { modelName: 'auth_sessions' },
    account: { modelName: 'auth_accounts' },
    verification: { modelName: 'auth_verifications' },
    // 表示名を検証して入れる口を PUT /v1/me だけにするため。update-user は長さを問わず name と image を書ける
    disabledPaths: ['/update-user'],
    plugins: [bearer()],
  })
}

type Auth = ReturnType<typeof createAuth>

// 要求ごとに Better Auth を組み立て直さないよう、env ごとに 1 つ持つ
const instances = new WeakMap<Env, Auth>()

/** env の Better Auth。同じ env には同じインスタンスを返す */
export function getAuth(env: Env): Auth {
  let auth = instances.get(env)
  if (auth === undefined) {
    auth = createAuth(env)
    instances.set(env, auth)
  }
  return auth
}

/** headers の Bearer トークン（Better Auth のセッション）が有効ならそのユーザー id、無効なら null */
export async function sessionUserId(env: Env, headers: Headers): Promise<string | null> {
  const session = await getAuth(env).api.getSession({ headers })
  return session?.user.id ?? null
}
