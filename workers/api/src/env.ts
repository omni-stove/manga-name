import type { ProjectRoom } from './room'

/** wrangler.jsonc の bindings と secret。`cloudflare:workers` の env もこの型になる */
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      /** 1 プロジェクト 1 インスタンスの同期サーバ。`idFromName(projectId)` で引く */
      PROJECT_ROOMS: DurableObjectNamespace<ProjectRoom>
      /** 共有アクセストークン（secret）。Phase 3 で WS-14 の認証に置き換える */
      APP_ACCESS_TOKEN: string
    }
  }
}

export type Env = Cloudflare.Env
