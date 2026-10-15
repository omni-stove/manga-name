/** wrangler.jsonc の bindings と secret。`cloudflare:workers` の env もこの型になる */
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      /** アセット本体。キーは `<project_id>/<asset_id>` */
      ASSETS: R2Bucket
      /** 共有アクセストークン（secret）。Phase 3 で WS-14 の認証に置き換える */
      APP_ACCESS_TOKEN: string
      /** アップロード用署名 URL の HMAC 鍵（secret） */
      ASSET_URL_SECRET: string
      /** CORS で許可する apps/web のオリジン。カンマ区切り */
      WEB_ORIGINS: string
      /** ユーザー（X-Debug-User が無ければ共有トークン）あたりの月間生成回数の上限 */
      MONTHLY_GENERATION_LIMIT: string
    }
  }
}

export type Env = Cloudflare.Env
