import { betterAuth } from 'better-auth'
import { getOAuthState } from 'better-auth/api'
import { bearer, oneTimeToken } from 'better-auth/plugins'
import type { Env } from './env'
import { allowedOrigins } from './origins'
import { hashToken } from './token'

/** Better Auth の口を置くパス */
export const AUTH_BASE_PATH = '/v1/auth'

/** 招待リンクを通らずにユーザーを作ろうとしたときに、OAuth の戻り先の `?error=` に載る値 */
export const INVITE_REQUIRED = 'invite_required'
/** 招待リンクを通ったが、招待先と違うメールアドレスでユーザーを作ろうとしたときの値 */
export const INVITE_EMAIL_MISMATCH = 'invite_email_mismatch'

/**
 * Better Auth の `user.validateUserInfo`。ユーザーを新しく作るときだけ、ログインを始めた招待リンクのトークン
 * （`inviteToken()`）が期限内で、招待先がそのメールアドレスであることを求める。誰でも受け取れる招待ならメールアドレスは問わない。
 * トークンが無いか無効なら INVITE_REQUIRED、メールアドレスが違えば INVITE_EMAIL_MISMATCH で断る。
 * 既にいるユーザーのログインは通す
 */
export function validateSignUp(env: Env, inviteToken: () => Promise<unknown>) {
  return async ({
    user,
    source,
  }: {
    user: { email?: string | null }
    source: { action: string }
  }) => {
    if (source.action !== 'create-user') return
    const token = await inviteToken()
    const invite =
      typeof token === 'string'
        ? await env.DB.prepare(
            'SELECT email FROM project_invites WHERE token_hash = ?1 AND expires_at > ?2',
          )
            .bind(await hashToken(token), Date.now())
            .first<{ email: string | null }>()
        : null
    if (invite === null) return { error: INVITE_REQUIRED }
    if (invite.email !== null && user.email?.trim().toLowerCase() !== invite.email)
      return { error: INVITE_EMAIL_MISMATCH }
  }
}

/**
 * env の D1 にユーザーとセッションを置く Better Auth。ログインは Google OAuth だけで、
 * `POST /v1/auth/sign-in/social` から始める。セッショントークンは応答の `set-auth-token` で渡り、
 * 以降は `Authorization: Bearer <token>` で送る。
 * 新しいユーザーは、`additionalData.inviteToken` に招待リンクのトークンを載せてログインを始めたときだけ作れる。
 * 断ったときは OAuth の戻り先（`errorCallbackURL`）へ validateSignUp の `?error=` を付けて返す。
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
      // additionalData はクライアントが決める値だが、トークンそのものを D1 の招待と照らすので信じてよい
      validateUserInfo: validateSignUp(env, async () => (await getOAuthState())?.inviteToken),
    },
    session: { modelName: 'auth_sessions' },
    account: { modelName: 'auth_accounts' },
    verification: { modelName: 'auth_verifications' },
    // 表示名を検証して入れる口を PUT /v1/me だけにするため。update-user は長さを問わず name と image を書ける
    disabledPaths: ['/update-user'],
    plugins: [
      bearer(),
      // Desktop のログインで OS のブラウザからアプリへセッションを渡す。deep link の URL はほかのアプリにも見えうるので、
      // 一度きりで 3 分で切れるトークンにし、D1 にはハッシュで置く
      oneTimeToken({ storeToken: 'hashed', disableSetSessionCookie: true }),
    ],
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
