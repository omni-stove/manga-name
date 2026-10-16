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
