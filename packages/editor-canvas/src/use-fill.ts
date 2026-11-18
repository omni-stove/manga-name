import {
  containsPoint,
  type Fill,
  type ID,
  newId,
  type Page,
  type Patch,
  type Point,
  polygonArea,
} from '@manga/schema'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useRef,
  useState,
} from 'react'
import type { FillTool } from './types'
import { type ClientBox, clientToPage, type View } from './view'

/** 点を間引く距離。ページ幅に対する比率。塗りは輪郭の細かさが要らないので手描きの線より粗く取る */
const FILL_MIN_STEP = 0.004
/** なぞった範囲がこれ（mm²）より狭ければ塗りにせず、押した位置の塗りを選ぶクリックとみなす */
const MIN_FILL_MM2 = 4

interface Options {
  page: Page
  /** ページの大きさ（mm） */
  width: number
  height: number
  view: View
  /** fill ツールが選ばれていて操作を受けるか */
  active: boolean
  tool: FillTool
  /** なぞっている途中の多角形。React を通さず points 属性を直接書き換える */
  liveRef: RefObject<SVGPolygonElement | null>
  onChange(patch: Patch): void
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const round = (v: number) => Math.round(v * 1e5) / 1e5

function boxOf(el: Element): ClientBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** 塗りの points 属性（mm） */
export function fillPoints(points: Point[], width: number, height: number): string {
  return points.map((p) => `${p.x * width},${p.y * height}`).join(' ')
}

/** ページ座標 p を含む、いちばん上（配列の後ろ）の塗りの添字。無ければ -1 */
function fillAt(fills: readonly Fill[], p: Point): number {
  for (let i = fills.length - 1; i >= 0; i--) {
    if (containsPoint((fills[i] as Fill).points, p)) return i
  }
  return -1
}

/**
 * `fill` ツールの入力。ドラッグでなぞった線を始点へ閉じた多角形にし、pointerup で `tool` の色の Fill を
 * `/fills/-` に足す Patch を 1 回だけ出す（fills がまだ無ければ配列ごと足す）。
 * なぞった範囲が狭いときはクリックとみなし、押した位置のいちばん上の塗りを選ぶ（無ければ選択を外す）。
 * 選んだ塗りは Delete か Backspace で消す。塗りの選択はキャンバスの Selection とは別に、このフックの中だけで持つ。
 * 2 本目の指が触れたら描きかけの塗りは捨て、ピンチとパンは useViewport に任せる
 */
export function useFill(opts: Options) {
  const drawing = useRef<{ pointerId: number; points: Point[]; attr: string } | null>(null)
  const touches = useRef(new Set<number>())
  const [selectedId, setSelectedId] = useState<ID | null>(null)
  const fills = opts.page.fills ?? []
  // Undo や他の人の編集で消えた塗りを選んだままにしない
  const selected = fills.find((f) => f.id === selectedId) ?? null

  const clear = () => {
    drawing.current = null
    opts.liveRef.current?.setAttribute('points', '')
  }
  const append = (e: { clientX: number; clientY: number }, box: ClientBox) => {
    const d = drawing.current
    const p = clientToPage(opts.view, box, { x: e.clientX, y: e.clientY })
    if (!d || !p) return
    const point = { x: round(clamp01(p.x / opts.width)), y: round(clamp01(p.y / opts.height)) }
    const last = d.points[d.points.length - 1]
    if (
      last &&
      Math.hypot((point.x - last.x) * opts.width, (point.y - last.y) * opts.height) <
        FILL_MIN_STEP * opts.width
    ) {
      return
    }
    d.points.push(point)
    d.attr += `${d.attr ? ' ' : ''}${point.x * opts.width},${point.y * opts.height}`
    opts.liveRef.current?.setAttribute('points', d.attr)
  }

  const endTouch = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') touches.current.delete(e.pointerId)
  }

  const handlers = {
    onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
      if (!opts.active) return
      if (e.pointerType === 'touch') {
        touches.current.add(e.pointerId)
        if (touches.current.size > 1) {
          clear()
          return
        }
      }
      // Space や中ボタンのパンは useViewport が preventDefault 済み
      if (e.defaultPrevented || e.button !== 0 || drawing.current) return
      e.currentTarget.focus({ preventScroll: true })
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // pointerdown の処理中に指が離れていると NotFoundError になる。キャプチャ無しでも描ける
      }
      drawing.current = { pointerId: e.pointerId, points: [], attr: '' }
      append(e, boxOf(e.currentTarget))
    },
    onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
      if (drawing.current?.pointerId !== e.pointerId) return
      const box = boxOf(e.currentTarget)
      const events = e.nativeEvent.getCoalescedEvents?.() ?? []
      for (const ev of events.length > 0 ? events : [e]) append(ev, box)
    },
    onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
      endTouch(e)
      const d = drawing.current
      if (d?.pointerId !== e.pointerId) return
      clear()
      const mm = d.points.map((p) => ({ x: p.x * opts.width, y: p.y * opts.height }))
      if (d.points.length < 3 || polygonArea(mm) < MIN_FILL_MM2) {
        const start = d.points[0]
        const i = start ? fillAt(fills, start) : -1
        setSelectedId(i >= 0 ? (fills[i] as Fill).id : null)
        return
      }
      const fill: Fill = { id: newId(), points: d.points, color: opts.tool }
      opts.onChange(
        opts.page.fills
          ? [{ op: 'add', path: '/fills/-', value: fill }]
          : [{ op: 'add', path: '/fills', value: [fill] }],
      )
      setSelectedId(null)
    },
    onPointerCancel(e: ReactPointerEvent<SVGSVGElement>) {
      endTouch(e)
      if (drawing.current?.pointerId === e.pointerId) clear()
    },
    /** 選んだ塗りを消すか選択を外したら true。キャンバスの他のキー操作には回さない */
    onKeyDown(e: ReactKeyboardEvent<SVGSVGElement>): boolean {
      if (!opts.active || selected === null || e.target !== e.currentTarget) return false
      if (e.key === 'Escape') {
        setSelectedId(null)
        return true
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return false
      e.preventDefault()
      opts.onChange([{ op: 'remove', path: `/fills/${fills.indexOf(selected)}` }])
      setSelectedId(null)
      return true
    },
  }

  return { handlers, selected: opts.active ? selected : null }
}
