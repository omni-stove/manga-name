import { newId, type Page, type Patch, type Point, type Stroke } from '@manga/schema'
import { type PointerEvent as ReactPointerEvent, type RefObject, useRef } from 'react'
import { DEFAULT_PRESSURE, pressureSegment, pressureWidth } from './pressure-stroke'
import type { ScribbleTool } from './types'
import { type ClientBox, clientToPage, type View } from './view'

/** 点を間引く距離と線の太さ。どちらもページ幅に対する比率 */
const SCRIBBLE_MIN_STEP = 0.002
export const SCRIBBLE_WIDTH = 0.002
/** 消しゴムがストロークを拾う距離（画面 px）。細い線をクリックで当てられるようにする */
const ERASE_SLOP_PX = 6

interface Options {
  page: Page
  /** 線を足す先。scribbles は誰でも書けるメモ、sketch は原作者の下描き */
  key: 'scribbles' | 'sketch'
  /** ページの大きさ（mm） */
  width: number
  height: number
  view: View
  tool: ScribbleTool
  /** 描画中の線。React を通さず points 属性を直接書き換える */
  liveRef: RefObject<SVGPolylineElement | null>
  /** ペンで描画中の線の輪郭。liveRef と同じく d 属性を直接書き換える */
  livePenRef: RefObject<SVGPathElement | null>
  onChange(patch: Patch): void
}

type Mm = { x: number; y: number }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
// 間引き幅 0.002 より十分細かい桁で切り、保存する JSON を短くする
const round = (v: number) => Math.round(v * 1e5) / 1e5
// 太さの差が見えない桁で切る
const roundPressure = (v: number) => Math.round(clamp01(v) * 100) / 100

function boxOf(el: Element): ClientBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** ストロークの points 属性（mm）。1 点だけのストロークは同じ点を重ねて丸い点にする */
export function polylinePoints(points: Point[], width: number, height: number): string {
  const s = points.map((p) => `${p.x * width},${p.y * height}`)
  return s.length === 1 ? `${s[0]} ${s[0]}` : s.join(' ')
}

function segmentDistance(p: Mm, a: Mm, b: Mm): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** p（mm）から tolerance mm 以内にある、いちばん上（配列の後ろ）のストロークの添字。無ければ -1 */
function strokeAt(
  scribbles: Stroke[],
  width: number,
  height: number,
  p: Mm,
  tolerance: number,
): number {
  const mm = (q: Point): Mm => ({ x: q.x * width, y: q.y * height })
  for (let i = scribbles.length - 1; i >= 0; i--) {
    const stroke = scribbles[i] as Stroke
    let peak = DEFAULT_PRESSURE
    if (stroke.pressure) {
      // 展開すると引数の上限を超えて RangeError になりうるので、ループで points の範囲だけ見る
      for (let k = 0; k < stroke.points.length; k++) peak = Math.max(peak, stroke.pressure[k] ?? 0)
    }
    const thickest = stroke.pressure ? pressureWidth(stroke.width, peak) : stroke.width
    const reach = tolerance + (thickest * width) / 2
    const pts = stroke.points.map(mm)
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j] as Mm
      if (segmentDistance(p, a, pts[j + 1] ?? a) <= reach) return i
    }
  }
  return -1
}

/**
 * `scribble` と `sketch` ツールの入力。マウス、ペン、1 本指のタッチで線を引き、pointerup で
 * `/<key>/-` に Stroke を足す Patch を 1 回だけ出す（sketch がまだ無ければ配列ごと足す）。2 本目の指が触れたら描きかけの線は捨て、
 * ピンチとパンは useViewport に任せる。消しゴムは押した位置のストロークを 1 本消す。
 * ペンで描いた線は点ごとの筆圧を Stroke.pressure に持ち、描いている間は livePenRef に輪郭を描く
 */
export function useScribble(opts: Options) {
  // pressure はペンのときだけ持つ。マウスと指は筆圧が取れず、Pointer Events が 0.5 か 0 を返すだけなので一定の太さで描く
  const drawing = useRef<{
    pointerId: number
    points: Point[]
    attr: string
    pressure: number[] | null
  } | null>(null)
  const touches = useRef(new Set<number>())
  // タッチの消しゴムは、2 本目の指が来ないと分かる pointerup まで消さない
  const pendingErase = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null)

  const clear = () => {
    drawing.current = null
    pendingErase.current = null
    opts.liveRef.current?.setAttribute('points', '')
    opts.livePenRef.current?.setAttribute('d', '')
  }
  const toPage = (e: { clientX: number; clientY: number }, box: ClientBox): Mm | null =>
    clientToPage(opts.view, box, { x: e.clientX, y: e.clientY })
  const append = (p: Mm, pressure: number) => {
    const d = drawing.current
    if (!d) return
    const last = d.points[d.points.length - 1]
    const point = { x: round(clamp01(p.x / opts.width)), y: round(clamp01(p.y / opts.height)) }
    if (
      last &&
      Math.hypot((point.x - last.x) * opts.width, (point.y - last.y) * opts.height) <
        SCRIBBLE_MIN_STEP * opts.width
    ) {
      return
    }
    d.points.push(point)
    const at = { x: point.x * opts.width, y: point.y * opts.height }
    if (d.pressure) {
      // 輪郭は点ごとの丸と台形を足していくだけなので、描きかけの線を毎回作り直さずに済む
      const q = roundPressure(pressure)
      const r = (v: number) => pressureWidth(SCRIBBLE_WIDTH * opts.width, v) / 2
      d.attr += pressureSegment(
        last ? { x: last.x * opts.width, y: last.y * opts.height } : null,
        r(d.pressure[d.pressure.length - 1] ?? q),
        at,
        r(q),
      )
      d.pressure.push(q)
      opts.livePenRef.current?.setAttribute('d', d.attr)
      return
    }
    d.attr += `${d.attr ? ' ' : ''}${at.x},${at.y}`
    opts.liveRef.current?.setAttribute('points', d.attr)
  }
  const erase = (at: { clientX: number; clientY: number }, svg: SVGSVGElement) => {
    const box = boxOf(svg)
    const p = toPage(at, box)
    const q = toPage({ clientX: at.clientX + ERASE_SLOP_PX, clientY: at.clientY }, box)
    if (!p || !q) return
    const i = strokeAt(opts.page[opts.key] ?? [], opts.width, opts.height, p, q.x - p.x)
    if (i >= 0) opts.onChange([{ op: 'remove', path: `/${opts.key}/${i}` }])
  }

  const endTouch = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') touches.current.delete(e.pointerId)
  }

  const handlers = {
    onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
      if (e.pointerType === 'touch') {
        touches.current.add(e.pointerId)
        if (touches.current.size > 1) {
          clear()
          return
        }
      }
      // Space や中ボタンのパンは useViewport が preventDefault 済み
      if (e.defaultPrevented || e.button !== 0) return
      if (drawing.current) return
      e.currentTarget.focus({ preventScroll: true })
      if (opts.tool === 'eraser') {
        if (e.pointerType === 'touch') {
          pendingErase.current = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY }
        } else {
          erase(e, e.currentTarget)
        }
        return
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // pointerdown の処理中に指が離れていると NotFoundError になる。キャプチャ無しでも描ける
      }
      drawing.current = {
        pointerId: e.pointerId,
        points: [],
        attr: '',
        pressure: e.pointerType === 'pen' ? [] : null,
      }
      const p = toPage(e, boxOf(e.currentTarget))
      if (p) append(p, e.pressure)
    },
    onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
      if (drawing.current?.pointerId !== e.pointerId) return
      const box = boxOf(e.currentTarget)
      // ペンは 1 フレームに複数の点を送ってくる。まとめられた分も拾わないと線が角張る
      const events = e.nativeEvent.getCoalescedEvents?.() ?? []
      for (const ev of events.length > 0 ? events : [e]) {
        const p = toPage(ev, box)
        if (p) append(p, ev.pressure)
      }
    },
    onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
      endTouch(e)
      const pending = pendingErase.current
      if (pending?.pointerId === e.pointerId) {
        pendingErase.current = null
        erase(pending, e.currentTarget)
        return
      }
      const d = drawing.current
      if (d?.pointerId !== e.pointerId) return
      clear()
      if (d.points.length === 0) return
      const stroke: Stroke = {
        id: newId(),
        points: d.points,
        width: SCRIBBLE_WIDTH,
        color: opts.tool === 'eraser' ? 'ink' : opts.tool,
        ...(d.pressure && { pressure: d.pressure }),
      }
      opts.onChange(
        opts.page[opts.key]
          ? [{ op: 'add', path: `/${opts.key}/-`, value: stroke }]
          : [{ op: 'add', path: `/${opts.key}`, value: [stroke] }],
      )
    },
    onPointerCancel(e: ReactPointerEvent<SVGSVGElement>) {
      endTouch(e)
      if (pendingErase.current?.pointerId === e.pointerId) pendingErase.current = null
      if (drawing.current?.pointerId === e.pointerId) clear()
    },
  }

  return { handlers }
}
