import { useRef } from 'react'

/** 参考画像と参照画像に読み込めるファイル */
export const REFERENCE_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf'

/** 非表示のファイル入力と、そのダイアログを開く関数。`input` は画面のどこかに置く */
export function useFilePicker(accept: string, onPick: (file: File) => void) {
  const ref = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0]
        // 同じファイルを選び直しても change が出るように空にする
        e.target.value = ''
        if (file) onPick(file)
      }}
    />
  )
  return { open: () => ref.current?.click(), input }
}
