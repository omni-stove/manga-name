import { loadTypefaceFont } from '@manga/render'
import { bubbleTypeface, type Page, sfxLetterings, sfxTypeface } from '@manga/schema'
import { useEffect } from 'react'

/**
 * `page` のフキダシか描き文字が手書き風を使っていれば、書き出しと同じフォントを document.fonts に読み込む。
 * ほかの書体は OS の同じ系統の書体で代えられるが、手書き風は代わりがほぼ無い。
 * 1 つが数 MB あるので、使うページを開くまでは読み込まない
 */
export function useTypefaceFonts(page: Page | undefined): void {
  const hand =
    page?.panels.some(
      (panel) =>
        panel.bubbles.some((b) => bubbleTypeface(b) === 'hand') ||
        sfxLetterings(panel).some((f) => sfxTypeface(f) === 'hand'),
    ) ?? false
  useEffect(() => {
    if (!hand) return
    // 読めなければ page-layer の字族の並びで OS の書体に代わる。次に手書き風を使ったときに読み直す
    loadTypefaceFont('hand').catch(() => {})
  }, [hand])
}
