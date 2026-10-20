import { fixtures, type Page, type Panel } from '@manga/schema'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, vi } from 'vitest'

/**
 * 各 Inspector の in-source テストが jsdom で描画して操作するための道具。
 * テストブロックの中から `await import('./dom-harness')` で読むので、本番のバンドルには入らない。
 * 読み込んだテストファイルでは、各テストの後に描画を unmount し、DOM と偽のタイマーを戻す。
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export const project = fixtures.samplePage01
export const samplePage = project.episodes[0]?.pages[0] as Page
export const samplePanel = samplePage.panels[0] as Panel

/** `ref` を `url:<ref>` に解決する resolveAsset */
export const resolveAsset = (ref: string) => Promise.resolve(`url:${ref}`)

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  vi.useRealTimers()
})

/** null / undefined なら投げ、それ以外はそのまま返す */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing')
  return value
}

/** document.body に足した container に `element` を描画する。root は再描画に使う */
export async function render(element: ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  return { container, root }
}

/** React が拾う形で入力欄の値を変え、input イベントを出す */
export const setValue = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  must(Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set).call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const fieldLabelled = (container: HTMLElement, label: string) =>
  must(
    [...container.querySelectorAll('label')].find(
      (el) => el.firstElementChild?.textContent === label,
    ),
  )

/** 見出しが `label` の欄の input / textarea */
export const inputLabelled = (container: HTMLElement, label: string) =>
  must(fieldLabelled(container, label).querySelector('input, textarea')) as
    | HTMLInputElement
    | HTMLTextAreaElement

/** 見出しが `label` の欄の select */
export const selectLabelled = (container: HTMLElement, label: string) =>
  must(fieldLabelled(container, label).querySelector('select'))

/** select の値を変え、change イベントを出す */
export const choose = (select: HTMLSelectElement, value: string) =>
  act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

/** aria-label か、無ければ文字が `name` のボタン */
export const buttonNamed = (container: HTMLElement, name: string) =>
  must(
    [...container.querySelectorAll('button')].find(
      (b) => (b.getAttribute('aria-label') ?? b.textContent) === name,
    ),
  )
