import type { CopiedElement } from '@manga/editor-canvas'
import {
  BubbleSchema,
  FocusPointSchema,
  type ID,
  PanelSchema,
  RectSchema,
  VectorSchema,
} from '@manga/schema'
import { useEffect, useEffectEvent } from 'react'
import { isEditable } from './use-undo-shortcuts'

/** クリップボードの文字列がこのアプリの要素であることを示す印 */
const FORMAT = 'manga/element'

/** クリップボードに載せる要素と、そのコピー元のプロジェクト */
export interface ClipboardElement {
  projectId: ID
  element: CopiedElement
}

/**
 * クリップボードに書く文字列。独自の MIME type は同じブラウザの中でしか渡らないので、
 * Desktop とブラウザの間でも貼れるよう text/plain の JSON にする
 */
export const serializeElement = (clip: ClipboardElement) =>
  JSON.stringify({ format: FORMAT, ...clip })

/** serializeElement の文字列を読む。ほかの文字列や、今のスキーマに合わない要素なら null */
export function parseElement(text: string): ClipboardElement | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const { format, projectId, element } = data as Record<string, unknown>
  if (format !== FORMAT || typeof projectId !== 'string') return null
  if (typeof element !== 'object' || element === null) return null
  const e = element as Record<string, unknown>
  const panelId = typeof e.panelId === 'string' ? e.panelId : undefined
  const spread = e.spread === true
  const parsed = ((): CopiedElement | null => {
    if (e.kind === 'panel') {
      const panel = PanelSchema.safeParse(e.panel)
      return panel.success ? { kind: 'panel', panel: panel.data, spread } : null
    }
    if (panelId === undefined) return null
    if (e.kind === 'bubble') {
      const bubble = BubbleSchema.safeParse(e.bubble)
      const panelRect = RectSchema.safeParse(e.panelRect)
      return bubble.success && panelRect.success
        ? { kind: 'bubble', bubble: bubble.data, panelId, panelRect: panelRect.data, spread }
        : null
    }
    if (e.kind === 'focus') {
      const focus = FocusPointSchema.safeParse(e.focus)
      return focus.success ? { kind: 'focus', focus: focus.data, panelId } : null
    }
    if (e.kind === 'vector') {
      const vector = VectorSchema.safeParse(e.vector)
      return vector.success ? { kind: 'vector', vector: vector.data, panelId } : null
    }
    return null
  })()
  return parsed && { projectId, element: parsed }
}

/** 文字を選んでいるか、入力欄かダイアログの中か。そこでのコピーと貼り付けはブラウザに任せる */
function editingText(target: EventTarget | null): boolean {
  if (isEditable(target)) return true
  if (target instanceof Element && target.closest('dialog') !== null) return true
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed
}

interface Options {
  /** 今コピーできる要素。無ければ null で、ブラウザのコピーに任せる */
  copy(): ClipboardElement | null
  /** 貼り付ける。省くと貼り付けを受けない */
  paste?(clip: ClipboardElement): void
  enabled: boolean
}

/**
 * Cmd / Ctrl + C で要素をコピーし、Cmd / Ctrl + V で貼り付ける。Desktop の「編集」メニューも同じ copy と paste の
 * イベントを出すので、キーではなくイベントで受ける。文字の選択中、入力欄とダイアログの中では受けず、
 * このアプリの要素でない貼り付け（参考画像など）にも触らない。`enabled` が false の間は受けない
 */
export function useElementClipboard({ copy, paste, enabled }: Options): void {
  const onCopy = useEffectEvent((e: ClipboardEvent) => {
    if (!e.clipboardData || editingText(e.target)) return
    const clip = copy()
    if (!clip) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', serializeElement(clip))
  })
  const onPaste = useEffectEvent((e: ClipboardEvent) => {
    if (!paste || !e.clipboardData || editingText(e.target)) return
    const clip = parseElement(e.clipboardData.getData('text/plain'))
    if (!clip) return
    e.preventDefault()
    paste(clip)
  })
  useEffect(() => {
    if (!enabled) return
    window.addEventListener('copy', onCopy)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('paste', onPaste)
    }
  }, [enabled])
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const panel = fixtures.samplePage01.episodes[0]?.pages[0]?.panels[2]
  if (!panel) throw new Error('fixture にコマがない')
  const bubble = panel.bubbles[0]
  if (!bubble) throw new Error('fixture にフキダシがない')

  test('parseElement reads back what serializeElement wrote', () => {
    const clips: ClipboardElement[] = [
      { projectId: 'p', element: { kind: 'panel', panel, spread: false } },
      {
        projectId: 'p',
        element: {
          kind: 'bubble',
          bubble,
          panelId: panel.id,
          panelRect: panel.rect,
          spread: true,
        },
      },
    ]
    for (const clip of clips) expect(parseElement(serializeElement(clip))).toEqual(clip)
  })

  test('parseElement rejects other text and elements that do not fit the schema', () => {
    expect(parseElement('こんにちは')).toBeNull()
    expect(parseElement('{"format":"other"}')).toBeNull()
    const broken = { kind: 'bubble', bubble: { ...bubble, pos: { x: 2, y: 0 } }, panelId: 'x' }
    expect(parseElement(JSON.stringify({ format: FORMAT, projectId: 'p', element: broken }))).toBe(
      null,
    )
  })
}
