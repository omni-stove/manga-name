import type { ProjectRoom } from './room'

/** wrangler.jsonc の bindings と secret。`cloudflare:workers` の env もこの型になる */
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      /** 1 プロジェクト 1 インスタンスの同期サーバ。`idFromName(projectId)` で引く */
      PROJECT_ROOMS: DurableObjectNamespace<ProjectRoom>
      /** アセット本体。キーは `<project_id>/<asset_id>` */
      ASSETS: R2Bucket
      /** Cloudflare Images。Gemini の JPEG を PNG にする */
      IMAGES: ImagesBinding
      /** Better Auth のセッションと Cookie の署名鍵（secret） */
      BETTER_AUTH_SECRET: string
      /** この Worker の公開 URL。OAuth のコールバック URL の組み立てに使う。無ければ要求の URL から推す */
      BETTER_AUTH_URL?: string
      /** Google OAuth のクライアント（secret）。無ければログインできず、開発時の X-Debug-User だけが通る */
      GOOGLE_CLIENT_ID?: string
      GOOGLE_CLIENT_SECRET?: string
      /** development なら X-Debug-User でユーザーを名乗れる */
      ENVIRONMENT: string
      /** Gemini の API キー（secret）。無ければ画像生成は Fake */
      GEMINI_API_KEY?: string
      /** Anthropic の API キー（secret）。無ければ LLM は Fake */
      ANTHROPIC_API_KEY?: string
      /** アップロード用署名 URL の HMAC 鍵（secret） */
      ASSET_URL_SECRET: string
      /** CORS で許可する apps/web のオリジン。カンマ区切り */
      WEB_ORIGINS: string
      /** 接続を許す国（ISO 3166-1 alpha-2）。カンマ区切り。空なら国で制限しない */
      ALLOWED_COUNTRIES?: string
      /** ユーザーあたりの月間生成回数の上限 */
      MONTHLY_GENERATION_LIMIT: string
    }
  }
}

export type Env = Cloudflare.Env
