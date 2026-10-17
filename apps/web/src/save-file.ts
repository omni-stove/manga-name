import { detectPlatform } from '@manga/storage'

/** 保存ダイアログで選べる拡張子 */
export interface FileFilter {
  name: string
  extensions: string[]
}

/**
 * Blob をファイルに保存する。Desktop は保存ダイアログで書き出し先を選ばせて書き、Web はダウンロードにする。
 * 保存したパスを返す。ダイアログを閉じたときと Web では null
 */
export async function saveFile(
  blob: Blob,
  fileName: string,
  filters?: FileFilter[],
): Promise<string | null> {
  if (detectPlatform() === 'web') {
    downloadBlob(blob, fileName)
    return null
  }
  const [{ save }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])
  const path = await save({ defaultPath: fileName, filters })
  if (path === null) return null
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
  return path
}

/** Blob をブラウザのダウンロードとして保存する */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // click の直後に解放すると、ダウンロードが始まる前に URL が消えることがある
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest
  const { installFakeTauri } = await import('./desktop/fake-tauri')

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const blob = new Blob(['abc'])
  const filters = [{ name: 'PNG', extensions: ['png'] }]

  describe('saveFile', () => {
    test('on the web it downloads the blob and frees the URL afterwards', async () => {
      vi.useFakeTimers()
      const anchor = { href: '', download: '', click: vi.fn() }
      vi.stubGlobal('document', { createElement: vi.fn(() => anchor) })
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

      expect(await saveFile(blob, 'a.png', filters)).toBeNull()
      expect(anchor).toMatchObject({ href: 'blob:x', download: 'a.png' })
      expect(anchor.click).toHaveBeenCalledOnce()
      expect(revoke).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1000)
      expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:x')
    })

    test('on the desktop it writes the bytes to the chosen path', async () => {
      vi.stubGlobal('isTauri', true)
      const invoke = vi.fn((cmd: string, _args: unknown, _options?: unknown): unknown =>
        cmd === 'plugin:dialog|save' ? '/out/a.png' : null,
      )
      installFakeTauri(vi.stubGlobal, invoke)

      expect(await saveFile(blob, 'a.png', filters)).toBe('/out/a.png')
      expect(invoke).toHaveBeenCalledWith(
        'plugin:dialog|save',
        { options: { defaultPath: 'a.png', filters } },
        undefined,
      )
      const write = invoke.mock.calls.find(([cmd]) => cmd === 'plugin:fs|write_file')
      expect(write?.[1]).toEqual(new Uint8Array([97, 98, 99]))
      expect(write?.[2]).toMatchObject({ headers: { path: encodeURIComponent('/out/a.png') } })
    })

    test('on the desktop it writes nothing when the dialog is closed', async () => {
      vi.stubGlobal('isTauri', true)
      const invoke = vi.fn((_cmd: string, _args: unknown, _options?: unknown): unknown => null)
      installFakeTauri(vi.stubGlobal, invoke)

      expect(await saveFile(blob, 'a.png')).toBeNull()
      expect(invoke.mock.calls.map(([cmd]) => cmd)).toEqual(['plugin:dialog|save'])
    })
  })
}
