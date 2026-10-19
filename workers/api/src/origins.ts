/**
 * Tauri アプリの WebView のオリジン。Tauri 2 では macOS・Linux・iOS が `tauri://localhost`、
 * Windows・Android が `http://tauri.localhost` になる
 */
const TAURI_ORIGINS = ['tauri://localhost', 'http://tauri.localhost']

/** CORS と Better Auth の trustedOrigins に使う、WEB_ORIGINS と TAURI_ORIGINS */
export function allowedOrigins(webOrigins: string | undefined) {
  const origins = (webOrigins ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '')
  return [...origins, ...TAURI_ORIGINS]
}
