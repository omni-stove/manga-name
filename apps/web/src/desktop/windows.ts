import type { ID } from '@manga/schema'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow'

/** tauri.conf.json の最初のウィンドウのラベル */
export const MAIN_WINDOW = 'main'

/**
 * エピソードの脚本を開くウィンドウのラベル。capabilities/default.json の `windows` が `script-*` で許すので、接頭辞を変えるときはそちらも直す。
 * ラベルに使えない文字は `_` にする
 */
export const scriptWindowLabel = (projectId: ID, episodeId: ID): string =>
  `script-${projectId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${episodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`

/** メインのウィンドウがフォーカスのないまま受けた Undo / Redo を、フォーカスのあるウィンドウへ渡す event。payload は `'undo' | 'redo'` */
export const EDIT_EVENT = 'desktop-edit'

/** 脚本のウィンドウで、メニューの Undo / Redo を入力欄自身の取り消しとして実行する。フォーカスのないウィンドウは何もしない */
export async function listenEdit(): Promise<void> {
  await listen<'undo' | 'redo'>(EDIT_EVENT, (e) => {
    if (document.hasFocus()) document.execCommand(e.payload)
  })
}

/** このページを載せているのがメインのウィンドウか。アプリメニューはメインのウィンドウだけが張る */
export const isMainWindow = (): boolean => getCurrentWebviewWindow().label === MAIN_WINDOW

/**
 * 同じアプリの `url`（ルーターの href）を、エピソードごとの別ウィンドウで開く。
 * エピソードの ID はプロジェクトをまたいで重なりうるので、ラベルにはプロジェクトの ID も入れる。同じエピソードのウィンドウがもうあれば、作り直さず前に出す
 */
export async function openScriptWindow({
  projectId,
  episodeId,
  url,
  title,
}: {
  projectId: ID
  episodeId: ID
  url: string
  title: string
}): Promise<void> {
  const label = scriptWindowLabel(projectId, episodeId)
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
      expect(scriptWindowLabel('p', 'ep_1-a')).toBe('script-p-ep_1-a')
      expect(scriptWindowLabel('p.1', 'ep.1 a')).toBe('script-p_1-ep_1_a')
    })
  })
}
