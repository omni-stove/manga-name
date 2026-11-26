import { Button } from '@manga/ui'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import styles from './spotlight.module.css'

interface SpotlightProps {
  /** 強調して吹き出しを向ける要素のセレクタ */
  target: string
  /** ぼかさずに見せたままにする要素のセレクタ */
  keep: readonly string[]
  /** 吹き出しの中身 */
  children: ReactNode
  /** 吹き出しの下に出す、案内をやめるボタンの文言 */
  dismissLabel: string
  /** `dismissLabel` のボタンか Esc を押した */
  onDismiss(): void
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** 吹き出しが `target` のどちら側にあるか。矢印はその逆の辺から `target` へ向ける */
export type Side = 'below' | 'above' | 'right' | 'left'

export interface TipPlacement {
  left: number
  top: number
  /** `target` の脇に置けなかったときは無く、矢印を出さない */
  side?: Side
  /** 矢印の、吹き出しの辺に沿った位置 */
  arrow: number
}

interface Size {
  width: number
  height: number
}

interface Layout {
  width: number
  height: number
  target: Box
  holes: Box[]
  tip: TipPlacement
}

const GAP = 6
const MARGIN = 16
// 空いた所を探す細かさ。1px ずつ試すと、対象の文字が多い画面で 1 フレームに収まらない
const STEP = 24
const SIDES: readonly Side[] = ['below', 'above', 'right', 'left']
const CONTROLS = 'input, textarea, select, button'

const box = (r: DOMRect, pad: number): Box => ({
  left: r.left - pad,
  top: r.top - pad,
  right: r.right + pad,
  bottom: r.bottom + pad,
})

const rectPath = (b: Box) => `M${b.left} ${b.top}H${b.right}V${b.bottom}H${b.left}Z`

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

const gap = (a: Box, b: Box) =>
  Math.hypot(
    Math.max(0, a.left - b.right, b.left - a.right),
    Math.max(0, a.top - b.bottom, b.top - a.bottom),
  )

const centerGap = (a: Box, b: Box) =>
  Math.hypot((a.left + a.right - b.left - b.right) / 2, (a.top + a.bottom - b.top - b.bottom) / 2)

const tipBox = (left: number, top: number, size: Size): Box => ({
  left,
  top,
  right: left + size.width,
  bottom: top + size.height,
})

/** `side` の脇に、画面からはみ出さずに置けるなら置き場所 */
function besides(side: Side, target: Box, size: Size, view: Size): TipPlacement | undefined {
  // 画面の外へはみ出した `target` は、見えている所の真ん中を指す
  const centerX = (Math.max(target.left, 0) + Math.min(target.right, view.width)) / 2
  const centerY = (Math.max(target.top, 0) + Math.min(target.bottom, view.height)) / 2
  if (side === 'below' || side === 'above') {
    const top = side === 'below' ? target.bottom + MARGIN : target.top - MARGIN - size.height
    if (top < MARGIN || top + size.height > view.height - MARGIN) return undefined
    const left = clamp(centerX - size.width / 2, MARGIN, view.width - size.width - MARGIN)
    return { left, top, side, arrow: clamp(centerX - left, MARGIN, size.width - MARGIN) }
  }
  const left = side === 'right' ? target.right + MARGIN : target.left - MARGIN - size.width
  if (left < MARGIN || left + size.width > view.width - MARGIN) return undefined
  const top = clamp(centerY - size.height / 2, MARGIN, view.height - size.height - MARGIN)
  return { left, top, side, arrow: clamp(centerY - top, MARGIN, size.height - MARGIN) }
}

/** `from` から `to` まで STEP ずつ。`to` が STEP の切れ目に無くても最後に入れる */
function steps(from: number, to: number): number[] {
  const out: number[] = []
  for (let v = from; v < to; v += STEP) out.push(v)
  out.push(Math.max(from, to))
  return out
}

/**
 * 吹き出しの置き場所。`obstacles`（見せたままの要素と、見せている所の文字や入力欄）に重ならないよう、
 * `target` の下・上・右・左の順に脇へ置き、どの脇にも収まらなければ画面のうち重ならない所で `target` に最も近い所、
 * それも無ければ `target` から最も離れた画面の隅に置く
 */
export function placeTip(
  target: Box,
  obstacles: readonly Box[],
  size: Size,
  view: Size,
): TipPlacement {
  const free = (left: number, top: number) =>
    !obstacles.some((o) => overlaps(tipBox(left, top, size), o))
  for (const side of SIDES) {
    const placed = besides(side, target, size, view)
    if (placed && free(placed.left, placed.top)) return placed
  }
  const xs = steps(MARGIN, view.width - size.width - MARGIN)
  const ys = steps(MARGIN, view.height - size.height - MARGIN)
  const spots = xs.flatMap((left) => ys.map((top) => ({ left, top })))
  const rank = (s: { left: number; top: number }) => {
    const b = tipBox(s.left, s.top, size)
    return [gap(b, target), centerGap(b, target)] as const
  }
  const before = (a: readonly [number, number], b: readonly [number, number]) =>
    a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1]
  let best: { left: number; top: number } | undefined
  let bestRank: readonly [number, number] | undefined
  for (const spot of spots) {
    if (!free(spot.left, spot.top)) continue
    const r = rank(spot)
    if (!bestRank || before(r, bestRank)) {
      best = spot
      bestRank = r
    }
  }
  if (best) return { ...best, arrow: 0 }
  const corners = [xs[0], xs.at(-1)].flatMap((left) =>
    [ys[0], ys.at(-1)].map((top) => ({ left: left ?? MARGIN, top: top ?? MARGIN })),
  )
  const [corner] = corners.sort((a, b) => (before(rank(b), rank(a)) ? -1 : 1))
  return { left: corner?.left ?? MARGIN, top: corner?.top ?? MARGIN, arrow: 0 }
}

/** `root` の中で画面に見えている文字と入力欄の枠 */
function textBoxes(root: Element, view: Size): Box[] {
  const out: Box[] = []
  const push = (r: DOMRect) => {
    const visible = r.right > 0 && r.bottom > 0 && r.left < view.width && r.top < view.height
    if (r.width > 0 && r.height > 0 && visible) out.push(box(r, 0))
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue
    range.selectNodeContents(node)
    for (const r of range.getClientRects()) push(r)
  }
  const controls = [...(root.matches(CONTROLS) ? [root] : []), ...root.querySelectorAll(CONTROLS)]
  for (const el of controls) push(el.getBoundingClientRect())
  return out
}

function measure(
  target: string,
  keep: readonly string[],
  tip: HTMLElement,
  place: typeof placeTip,
): Layout | null {
  const el = document.querySelector(target)
  if (!el) return null
  const view = { width: window.innerWidth, height: window.innerHeight }
  const t = box(el.getBoundingClientRect(), GAP)
  const kept = keep
    .flatMap((s) => [...document.querySelectorAll(s)])
    .map((e) => box(e.getBoundingClientRect(), 0))
  const size = { width: tip.offsetWidth, height: tip.offsetHeight }
  return {
    ...view,
    target: t,
    holes: [t, ...kept],
    tip: place(t, [...kept, ...textBoxes(el, view)], size, view),
  }
}

/** 入力が前と同じなら前の置き場所を返す。`placeTip` は空いた所を総当たりで探し、毎フレームは重い */
function memoPlace(): typeof placeTip {
  let lastKey = ''
  let last: TipPlacement | undefined
  return (target, obstacles, size, view) => {
    const key = JSON.stringify([target, obstacles, size, view])
    if (key !== lastKey || !last) {
      lastKey = key
      last = placeTip(target, obstacles, size, view)
    }
    return last
  }
}

/**
 * `target` と `keep` 以外を画面ごとぼかし、ぼかした所を押せなくする。
 * `target` は見える所までスクロールして枠で囲み、`children` の吹き出しを `placeTip` の置き場所から向ける。
 * 吹き出しの `dismissLabel` のボタンか Esc で `onDismiss` を呼ぶ。`target` が見つからない間は何も出さない
 */
export function Spotlight({ target, keep, children, dismissLabel, onDismiss }: SpotlightProps) {
  const tip = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  useEffect(() => {
    let last = ''
    let frame = 0
    let shown: Element | null = null
    const place = memoPlace()
    // 対象はサイドバーのスクロール、折り返し、生成中の表示の切り替えでも動き、まとめて受けられるイベントが無いので毎フレーム測る
    const tick = () => {
      const el = document.querySelector(target)
      if (el && el !== shown) {
        shown = el
        el.scrollIntoView({ block: 'center' })
      }
      const next = tip.current && measure(target, keep, tip.current, place)
      const key = JSON.stringify(next)
      if (key !== last) {
        last = key
        setLayout(next)
      }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [target, keep])
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      // ダイアログやメニューの中の Esc はそれを閉じるためのもので、案内までやめない
      if (e.target instanceof Element && e.target.closest('dialog, [role="dialog"], [role="menu"]'))
        return
      onDismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onDismiss])
  return (
    <>
      {layout && (
        <>
          <div
            className={styles.veil}
            style={{
              clipPath: `path(evenodd, "M0 0H${layout.width}V${layout.height}H0Z${layout.holes.map(rectPath).join('')}")`,
            }}
          />
          <div
            className={styles.ring}
            style={{
              left: layout.target.left,
              top: layout.target.top,
              width: layout.target.right - layout.target.left,
              height: layout.target.bottom - layout.target.top,
            }}
          />
        </>
      )}
      <div
        ref={tip}
        role="status"
        className={styles.tip}
        data-side={layout?.tip.side}
        style={
          {
            visibility: layout ? undefined : 'hidden',
            left: layout?.tip.left,
            top: layout?.tip.top,
            '--arrow': `${layout?.tip.arrow ?? 0}px`,
          } as CSSProperties
        }
      >
        {children}
        <div className={styles.actions}>
          <Button size="small" variant="ghost" className={styles.dismiss} onClick={onDismiss}>
            {dismissLabel}
          </Button>
        </div>
      </div>
    </>
  )
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const view = { width: 1000, height: 800 }
  const size = { width: 200, height: 100 }
  const at = (left: number, top: number, width: number, height: number): Box => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
  })
  const tipAt = (p: TipPlacement) => tipBox(p.left, p.top, size)

  describe('placeTip', () => {
    test('何も重ならなければ target の下に置き、矢印を target の真ん中へ向ける', () => {
      const placed = placeTip(at(400, 100, 200, 50), [], size, view)
      expect(placed).toEqual({ left: 400, top: 166, side: 'below', arrow: 100 })
    })

    test('下が見せたままの要素に重なれば上、上下とも塞がれば右へ置く', () => {
      const target = at(400, 300, 200, 50)
      const below = at(390, 360, 220, 200)
      expect(placeTip(target, [below], size, view).side).toBe('above')
      const above = at(390, 100, 220, 190)
      const placed = placeTip(target, [below, above], size, view)
      expect(placed.side).toBe('right')
      expect(placed.left).toBe(616)
    })

    test('どの脇にも収まらなければ、文字に重ならない所のうち target に最も近い所に置き、矢印を出さない', () => {
      // 画面を覆う target の中に文字が並び、右下だけが空いている
      const target = at(-6, -6, 1012, 812)
      const texts = [at(0, 0, 1000, 500), at(0, 500, 600, 300)]
      const placed = placeTip(target, texts, size, view)
      expect(placed.side).toBeUndefined()
      for (const t of texts) expect(overlaps(tipAt(placed), t)).toBe(false)
    })

    test('どこにも収まらなければ target から最も離れた画面の隅に置く', () => {
      const target = at(50, 50, 100, 100)
      const placed = placeTip(target, [at(0, 0, 1000, 800)], size, view)
      expect(placed).toMatchObject({ left: 784, top: 684 })
      expect(placed.side).toBeUndefined()
    })
  })
}
