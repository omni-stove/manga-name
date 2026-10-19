import type { ID } from '@manga/schema'
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow'

/** tauri.conf.json の最初のウィンドウのラベル */
export const MAIN_WINDOW = 'main'

/**
 * エピソードの脚本を開くウィンドウのラベル。capabilities/default.json の `windows` が `script-*` で許すので、接頭辞を変えるときはそちらも直す。
 * ラベルに使えない文字は `_` にする
 */
export const scriptWindowLabel = (episodeId: ID): string =>
  `script-${episodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`

/** このページを載せているのがメインのウィンドウか。アプリメニューはメインのウィンドウだけが張る */
export const isMainWindow = (): boolean => getCurrentWebviewWindow().label === MAIN_WINDOW

/**
 * 同じアプリの `url`（ルーターの href）を、エピソードごとの別ウィンドウで開く。
 * 同じエピソードのウィンドウがもうあれば、作り直さず前に出す
 */
export async function openScriptWindow({
  episodeId,
  url,
  title,
}: {
  episodeId: ID
  url: string
  title: string
}): Promise<void> {
  const label = scriptWindowLabel(episodeId)
  const existing = await WebviewWindow.getByLabel(label)
  if (existing) {
    await existing.setFocus()
    return
  }
  const created = new WebviewWindow(label, { url, title, width: 720, height: 800 })
  await new Promise<void>((resolve, reject) => {
    void created.once('tauri://created', () => resolve())
    void created.once<string>('tauri://error', (e) => reject(new Error(e.payload)))
  })
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest

  describe('scriptWindowLabel', () => {
    test('keeps the characters a window label allows and replaces the others', () => {
      expect(scriptWindowLabel('ep_1-a')).toBe('script-ep_1-a')
      expect(scriptWindowLabel('ep.1 a')).toBe('script-ep_1_a')
    })
  })
}
