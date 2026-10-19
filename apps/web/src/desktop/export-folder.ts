import type { ID } from '@manga/schema'
import { pageFileName } from '../export-page-job'
import { desktopStore } from './desktop-store'

// パスは端末ごとに違うので、プロジェクトのデータではなく desktop.json に置く
const KEY = 'exportFolders'

type ExportFolders = Partial<Record<ID, string>>

/** プロジェクトの書き出し先として覚えているフォルダ。選んだことが無ければ null */
export async function loadExportFolder(projectId: ID): Promise<string | null> {
  return (await (await desktopStore()).get<ExportFolders>(KEY))?.[projectId] ?? null
}

/**
 * フォルダの選択ダイアログを開き、選んだフォルダをプロジェクトの書き出し先として覚える。
 * `current` はダイアログを開く場所。選んだパスを返し、ダイアログを閉じたら何も覚えず null。
 * ダイアログで選んだフォルダへの書き込み許可は persisted-scope が再起動後も残す
 */
export async function chooseExportFolder(
  projectId: ID,
  current: string | null,
): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({ directory: true, defaultPath: current ?? undefined })
  if (path === null) return null
  const store = await desktopStore()
  await store.set(KEY, { ...(await store.get<ExportFolders>(KEY)), [projectId]: path })
  await store.save()
  return path
}

/**
 * ページごとの PNG を `folder` に `p03.png` の名前で書く。同じ名前のファイルは上書きする。
 * `render` で 1 ページずつ描いては書くので、描いた PNG を全部は持たない。1 ページ書くごとに onProgress を呼ぶ
 */
export async function writePageFiles(
  folder: string,
  numbers: readonly number[],
  render: (number: number) => Promise<Blob>,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<void> {
  const [{ join }, { writeFile }] = await Promise.all([
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-fs'),
  ])
  let done = 0
  for (const number of numbers) {
    const png = await render(number)
    // Windows のパスは `\` で区切るので、文字列でつながず OS の join に任せる
    const path = await join(folder, pageFileName(number))
    await writeFile(path, new Uint8Array(await png.arrayBuffer()))
    onProgress(++done, numbers.length)
  }
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest
  const { createFakeStoreIpc, installFakeTauri } = await import('./fake-tauri')

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** store と plugin:path|join、plugin:fs|write_file に答え、書いたファイルをパスごとに残す偽の Tauri */
  const fakeDesktop = (opened: string | null = null, initial: Record<string, unknown> = {}) => {
    const store = createFakeStoreIpc(initial)
    const files = new Map<string, Uint8Array>()
    const invoke = vi.fn(
      (cmd: string, args: unknown, options?: { headers?: Record<string, string> }): unknown => {
        if (cmd.startsWith('plugin:store|')) return store.handle(cmd, args)
        if (cmd === 'plugin:dialog|open') return opened
        if (cmd === 'plugin:path|join') return (args as { paths: string[] }).paths.join('/')
        if (cmd === 'plugin:fs|write_file') {
          files.set(decodeURIComponent(options?.headers?.path ?? ''), args as Uint8Array)
        }
        return null
      },
    )
    installFakeTauri(vi.stubGlobal, invoke)
    return { store, files, invoke }
  }

  describe('loadExportFolder / chooseExportFolder', () => {
    test('remembers the chosen folder per project and opens the dialog at the current one', async () => {
      const { store, invoke } = fakeDesktop('/sync/b', { exportFolders: { p1: '/sync/a' } })
      expect(await loadExportFolder('p1')).toBe('/sync/a')
      expect(await loadExportFolder('p2')).toBeNull()

      expect(await chooseExportFolder('p2', '/sync/a')).toBe('/sync/b')
      expect(invoke).toHaveBeenCalledWith(
        'plugin:dialog|open',
        { options: { directory: true, defaultPath: '/sync/a' } },
        undefined,
      )
      expect(store.values.get('exportFolders')).toEqual({ p1: '/sync/a', p2: '/sync/b' })
      expect(store.calls).toContain('plugin:store|save')
      expect(await loadExportFolder('p2')).toBe('/sync/b')
    })

    test('a closed dialog keeps the remembered folder', async () => {
      const { store } = fakeDesktop(null, { exportFolders: { p1: '/sync/a' } })
      expect(await chooseExportFolder('p1', '/sync/a')).toBeNull()
      expect(store.values.get('exportFolders')).toEqual({ p1: '/sync/a' })
      expect(store.calls).not.toContain('plugin:store|save')
    })
  })

  describe('writePageFiles', () => {
    test('writes one png per page under the zip entry names, overwriting earlier exports', async () => {
      const { files } = fakeDesktop()
      files.set('/sync/a/p03.png', new Uint8Array([0]))
      const progress: [number, number][] = []
      await writePageFiles(
        '/sync/a',
        [3, 10],
        async (n) => new Blob([new Uint8Array([n])]),
        (d, t) => progress.push([d, t]),
      )
      expect([...files]).toEqual([
        ['/sync/a/p03.png', new Uint8Array([3])],
        ['/sync/a/p10.png', new Uint8Array([10])],
      ])
      expect(progress).toEqual([
        [1, 2],
        [2, 2],
      ])
    })

    test('stops at the page that fails to render, keeping the pages already written', async () => {
      const { files } = fakeDesktop()
      const render = async (n: number) => {
        if (n === 2) throw new Error('boom')
        return new Blob([new Uint8Array([n])])
      }
      await expect(writePageFiles('/sync/a', [1, 2, 3], render)).rejects.toThrow('boom')
      expect([...files.keys()]).toEqual(['/sync/a/p01.png'])
    })
  })
}
