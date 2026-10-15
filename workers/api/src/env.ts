/** wrangler.jsonc の bindings と secret */
export interface Env {
  DB: D1Database
  /** 共有アクセストークン（secret）。Phase 3 で WS-14 の認証に置き換える */
  APP_ACCESS_TOKEN: string
}
