/** Tauri アプリの WebView のオリジン */
const TAURI_ORIGIN = 'tauri://localhost'

/** CORS と Better Auth の trustedOrigins に使う、WEB_ORIGINS と TAURI_ORIGIN */
export function allowedOrigins(webOrigins: string | undefined) {
  const origins = (webOrigins ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '')
  return [...origins, TAURI_ORIGIN]
}
