type Receiver = (file: File) => void

let receiver: Receiver | undefined

/**
 * Desktop で OS から落とした画像や PDF を、開いているページの編集画面の参考画像の取り込みで受ける。
 * Tauri がウィンドウへのドロップを WebView より先に取るので、キャンバスの onDrop には届かず、
 * `desktop/file-drop` がパスから読んだ File をここで渡す。受けるのは最後に登録した 1 つだけで、返す関数で外す
 */
export function receiveDroppedReference(onFile: Receiver): () => void {
  receiver = onFile
  return () => {
    if (receiver === onFile) receiver = undefined
  }
}

/** 落としたファイルを渡す先。参考画像を受けるページの編集画面が無ければ undefined */
export function droppedReferenceReceiver(): Receiver | undefined {
  return receiver
}

if (import.meta.vitest) {
  const { expect, test, vi } = import.meta.vitest

  test('the last registered editor receives, and removing an older one keeps it', () => {
    const first = vi.fn()
    const second = vi.fn()
    const removeFirst = receiveDroppedReference(first)
    const removeSecond = receiveDroppedReference(second)
    removeFirst()
    expect(droppedReferenceReceiver()).toBe(second)
    removeSecond()
    expect(droppedReferenceReceiver()).toBeUndefined()
  })
}
