import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'
import type { Env } from './env'
import { allowedOrigins } from './origins'

/** Better Auth の口を置くパス */
export const AUTH_BASE_PATH = '/v1/auth'

/** 招待されていないメールアドレスのユーザーを作ろうとしたときに、OAuth の戻り先の `?error=` に載る値 */
export const INVITE_REQUIRED = 'invite_required'

/**
 * Better Auth の `user.validateUserInfo`。ユーザーを新しく作るときだけ、そのメールアドレス宛ての期限内の招待を求め、
 * 無ければ INVITE_REQUIRED で断る。既にいるユーザーのログインは通す
 */
export function validateSignUp(env: Env) {
  return async ({
    user,
    source,
  }: {
    user: { email?: string | null }
    source: { action: string }
  }) => {
    if (source.action !== 'create-user') return
    const invite = user.email
      ? await env.DB.prepare(
          'SELECT 1 FROM project_invites WHERE email = ?1 AND expires_at > ?2 LIMIT 1',
        )
          .bind(user.email.trim().toLowerCase(), Date.now())
          .first()
      : null
    if (invite === null) return { error: INVITE_REQUIRED }
  }
}

/**
 * env の D1 にユーザーとセッションを置く Better Auth。ログインは Google OAuth だけで、
 * `POST /v1/auth/sign-in/social` から始める。セッショントークンは応答の `set-auth-token` で渡り、
 * 以降は `Authorization: Bearer <token>` で送る。
 * 招待の無いメールアドレスは validateSignUp で登録を断り、OAuth の戻り先（`errorCallbackURL`）へ
 * `?error=invite_required` を付けて返す。
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
    user: {
      modelName: 'auth_users',
      validateUserInfo: validateSignUp(env),
    },
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
