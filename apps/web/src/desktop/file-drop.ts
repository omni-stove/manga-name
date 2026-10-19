import { m } from '@manga/i18n'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { readFile } from '@tauri-apps/plugin-fs'
import { droppedReferenceReceiver } from '../dropped-reference'
import { errorMessage } from '../route-error'
import { toasts } from '../toasts'
import { recentLabel } from './recent-files'

/** 参考画像にできる拡張子と、File に付ける MIME。中身の形式は toReferenceImage が先頭のバイトで確かめる */
const REFERENCE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

// メニューの「開く」のダイアログと同じく、拡張子は最後の `.json` で見る
const isProjectFile = (path: string) => path.toLowerCase().endsWith('.json')

const referenceType = (path: string) => {
  const name = recentLabel(path)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? undefined : REFERENCE_TYPES[name.slice(dot + 1).toLowerCase()]
}

/**
 * Desktop のウィンドウに OS からファイルを落としたときの扱い。
 * 落としたファイルにプロジェクトの JSON（`.manga.json`）があれば、最初の 1 つを `openPath` に渡す。開けなければトーストを出す。
 * 無ければ最初のファイルが PNG / JPEG / WebP / PDF のとき、開いているページの編集画面の参考画像にする。
 * 編集画面が開いていないときと、それ以外のファイルは受け付けない旨をトーストで出す。
 * 落としたファイルの読み取りの許可は plugin-fs がドロップのときに足す
 *
 * @feature Desktop のウィンドウにファイルをドラッグ＆ドロップして、プロジェクトを開くか参考画像にする
 */
export function startFileDrop(openPath: (path: string) => Promise<void>): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === 'drop') void receive(payload.paths, openPath)
  })
}

async function receive(paths: string[], openPath: (path: string) => Promise<void>) {
  const project = paths.find(isProjectFile)
  if (project) {
    await openPath(project).catch((e: unknown) =>
      toasts.push(m.web_menu_open_failed({ reason: errorMessage(e) })),
    )
    return
  }
  const [path] = paths
  if (path === undefined) return
  const type = referenceType(path)
  if (!type) {
    toasts.push(m.web_drop_unsupported({ name: recentLabel(path) }))
    return
  }
  const importReference = droppedReferenceReceiver()
  if (!importReference) {
    toasts.push(m.web_drop_reference_outside_editor())
    return
  }
  try {
    const bytes = await readFile(path)
    // readFile の Uint8Array は SharedArrayBuffer の可能性を型に残すので、File が受け取れる形に写す
    importReference(new File([new Uint8Array(bytes)], recentLabel(path), { type }))
  } catch (e) {
    toasts.push(m.web_editor_reference_import_failed({ reason: errorMessage(e) }))
  }
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest
  const { receiveDroppedReference } = await import('../dropped-reference')
  const { installFakeTauri } = await import('./fake-tauri')

  const removers: (() => void)[] = []
  afterEach(() => {
    for (const remove of removers.splice(0)) remove()
    vi.unstubAllGlobals()
    toasts.state.setState({ toasts: [] })
  })

  const setup = async (files: Record<string, number[]> = {}) => {
    const listeners = new Map<string, number>()
    const reads: string[] = []
    const tauri = installFakeTauri(vi.stubGlobal, (cmd, args) => {
      switch (cmd) {
        case 'plugin:event|listen': {
          const { event, handler } = args as { event: string; handler: number }
          listeners.set(event, handler)
          return handler
        }
        case 'plugin:fs|read_file': {
          const { path } = args as { path: string }
          reads.push(path)
          const bytes = files[path]
          if (!bytes) throw new Error('no such file')
          return bytes
        }
        default:
          throw new Error(`unexpected IPC ${cmd}`)
      }
    })
    const openPath = vi.fn(async (_: string) => {})
    await startFileDrop(openPath)
    const emit = (event: string, payload: unknown) =>
      tauri.callback(listeners.get(event) ?? -1)?.({ event, id: 1, payload })
    return {
      openPath,
      reads,
      emit,
      drop: (...paths: string[]) => emit('tauri://drag-drop', { paths, position: { x: 0, y: 0 } }),
      toastMessages: () => toasts.state.getState().toasts.map((t) => t.message),
    }
  }

  /** 開いているページの編集画面の代わりに、落とした File を受ける */
  const openEditor = () => {
    const importReference = vi.fn()
    removers.push(receiveDroppedReference(importReference))
    return importReference
  }

  describe('startFileDrop', () => {
    test('a dropped project file is opened like the Open menu, ahead of other files', async () => {
      const importReference = openEditor()
      const win = await setup()
      win.drop('/w/ref.png', '/w/作品.manga.json', '/w/b.manga.json')
      await vi.waitFor(() => expect(win.openPath).toHaveBeenCalled())
      expect(win.openPath).toHaveBeenCalledExactlyOnceWith('/w/作品.manga.json')
      expect(importReference).not.toHaveBeenCalled()
      expect(win.reads).toEqual([])
    })

    test('a project file that cannot be opened shows the same toast as the Open menu', async () => {
      const win = await setup()
      win.openPath.mockRejectedValueOnce(new Error('JSON として読めません'))
      win.drop('C:\\w\\broken.MANGA.JSON')
      await vi.waitFor(() =>
        expect(win.toastMessages()).toEqual(['開けません: JSON として読めません']),
      )
    })

    test('an image dropped on the page editor becomes the reference image', async () => {
      const importReference = openEditor()
      const win = await setup({ '/w/ラフ.WebP': [1, 2, 3] })
      win.drop('/w/ラフ.WebP')
      await vi.waitFor(() => expect(importReference).toHaveBeenCalledOnce())
      const [file] = importReference.mock.calls[0] as [File]
      expect(file.name).toBe('ラフ.WebP')
      expect(file.type).toBe('image/webp')
      expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3])
      expect(win.openPath).not.toHaveBeenCalled()
    })

    test('a PDF is passed on with its MIME type', async () => {
      const importReference = openEditor()
      const win = await setup({ '/w/name.pdf': [37] })
      win.drop('/w/name.pdf')
      await vi.waitFor(() => expect(importReference).toHaveBeenCalledOnce())
      expect((importReference.mock.calls[0] as [File])[0].type).toBe('application/pdf')
    })

    test('an image dropped outside the page editor is not read and tells where to drop it', async () => {
      const win = await setup({ '/w/a.jpg': [1] })
      win.drop('/w/a.jpg')
      await vi.waitFor(() =>
        expect(win.toastMessages()).toEqual([
          '画像と PDF はページの編集画面に落とすと参考画像になります',
        ]),
      )
      expect(win.reads).toEqual([])
    })

    test('an image that cannot be read shows a toast', async () => {
      const importReference = openEditor()
      const win = await setup()
      win.drop('/w/gone.png')
      await vi.waitFor(() =>
        expect(win.toastMessages()).toEqual(['参考画像を読み込めません: no such file']),
      )
      expect(importReference).not.toHaveBeenCalled()
    })

    test('other files are refused with a toast and nothing is opened or read', async () => {
      const importReference = openEditor()
      const win = await setup()
      win.drop('/w/memo.txt')
      win.drop('/w/Makefile')
      await vi.waitFor(() => expect(win.toastMessages()).toHaveLength(2))
      expect(win.toastMessages()[0]).toBe(
        'memo.txt は受け付けません。.manga.json か、ページの編集画面で画像か PDF を落としてください',
      )
      expect(win.openPath).not.toHaveBeenCalled()
      expect(importReference).not.toHaveBeenCalled()
      expect(win.reads).toEqual([])
    })

    test('dragging over the window, leaving it or dropping nothing does nothing', async () => {
      const win = await setup()
      win.emit('tauri://drag-enter', { paths: ['/w/a.manga.json'], position: { x: 0, y: 0 } })
      win.emit('tauri://drag-over', { position: { x: 1, y: 1 } })
      win.emit('tauri://drag-leave', null)
      win.drop()
      await Promise.resolve()
      expect(win.openPath).not.toHaveBeenCalled()
      expect(win.toastMessages()).toEqual([])
    })
  })
}
