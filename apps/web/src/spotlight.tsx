import { type ReactNode, useEffect, useRef, useState } from 'react'
import styles from './spotlight.module.css'

interface SpotlightProps {
  /** 強調して吹き出しを向ける要素のセレクタ */
  target: string
  /** ぼかさずに見せたままにする要素のセレクタ */
  keep: readonly string[]
  /** 吹き出しの中身 */
  children: ReactNode
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

interface Layout {
  width: number
  height: number
  target: Box
  holes: Box[]
  tip: { left: number; top: number; arrow: number; above: boolean }
}

const GAP = 6
const MARGIN = 16

const box = (r: DOMRect, pad: number): Box => ({
  left: r.left - pad,
  top: r.top - pad,
  right: r.right + pad,
  bottom: r.bottom + pad,
})

const rectPath = (b: Box) => `M${b.left} ${b.top}H${b.right}V${b.bottom}H${b.left}Z`

function measure(target: string, keep: readonly string[], tip: HTMLElement) {
  const el = document.querySelector(target)
  if (!el) return null
  const t = box(el.getBoundingClientRect(), GAP)
  const kept = keep.flatMap((s) => [...document.querySelectorAll(s)])
  const holes = [t, ...kept.map((e) => box(e.getBoundingClientRect(), 0))]
  const width = tip.offsetWidth
  const height = tip.offsetHeight
  const center = (t.left + t.right) / 2
  const left = Math.min(Math.max(center - width / 2, MARGIN), window.innerWidth - width - MARGIN)
  const above = t.bottom + MARGIN + height > window.innerHeight
  const top = above ? t.top - MARGIN - height : t.bottom + MARGIN
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    target: t,
    holes,
    tip: {
      left,
      top: Math.min(Math.max(top, MARGIN), window.innerHeight - height - MARGIN),
      arrow: Math.min(Math.max(center - left, MARGIN), width - MARGIN),
      above,
    },
  }
}

/**
 * `target` と `keep` 以外を画面ごとぼかし、ぼかした所を押せなくする。
 * `target` は見える所までスクロールして枠で囲み、`children` の吹き出しをその下（入らなければ上）に向ける。`target` が見つからない間は何も出さない
 */
export function Spotlight({ target, keep, children }: SpotlightProps) {
  const tip = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  useEffect(() => {
    let last = ''
    let frame = 0
    let shown: Element | null = null
    // 対象はサイドバーのスクロール、折り返し、生成中の表示の切り替えでも動き、まとめて受けられるイベントが無いので毎フレーム測る
    const tick = () => {
      const el = document.querySelector(target)
      if (el && el !== shown) {
        shown = el
        el.scrollIntoView({ block: 'center' })
      }
      const next = tip.current && measure(target, keep, tip.current)
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
        data-above={layout?.tip.above || undefined}
        style={{
          visibility: layout ? undefined : 'hidden',
          left: layout?.tip.left,
          top: layout?.tip.top,
          ['--arrow-x' as string]: `${layout?.tip.arrow ?? 0}px`,
        }}
      >
        {children}
      </div>
    </>
  )
}
