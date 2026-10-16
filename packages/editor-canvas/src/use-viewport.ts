import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { type ClientBox, fitView, panBy, pinchView, type View, wheelFactor, zoomAt } from './view'

type Pos = { x: number; y: number }

type Gesture =
  | { kind: 'pan'; pointerId: number; last: Pos }
  | { kind: 'pinch'; ids: [number, number]; from: [Pos, Pos]; start: View }

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId)
  } catch {
    // pointerdown の処理中に指が離れていると NotFoundError になる。キャプチャ無しでも操作は続けられる
  }
}

function boxOf(el: Element): ClientBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * ズームとパン。ホイール（トラックパッドのピンチを含む）でカーソル位置を中心にズーム、
 * 2 本指のタッチでピンチズームとパン、Space を押しながらのドラッグと中ボタンドラッグでパンする。
 * Space はカーソルがキャンバス上にあるか、キャンバスにフォーカスがあるときだけ奪う。
 * ページの大きさが変わったら全体表示に戻す
 */
export function useViewport(svgRef: RefObject<SVGSVGElement | null>, pageW: number, pageH: number) {
  const base = useMemo(() => fitView(pageW, pageH), [pageW, pageH])
  const [state, setState] = useState({ base, view: base })
  if (state.base !== base) setState({ base, view: base })
  const view = state.base === base ? state.view : base
  const setView = (update: (v: View) => View) =>
    setState((s) => (s.base === base ? { base, view: update(s.view) } : s))

  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const spaceRef = useRef(false)
  const hovered = useRef(false)
  const pointers = useRef(new Map<number, Pos>())
  const gesture = useRef<Gesture | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    // React の onWheel は passive で preventDefault できず、ページごとスクロールしてしまう
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = boxOf(svg)
      const at = { x: e.clientX, y: e.clientY }
      const factor = wheelFactor(e)
      setState((s) => (s.base === base ? { base, view: zoomAt(s.view, base, box, at, factor) } : s))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [svgRef, base])

  useEffect(() => {
    const setSpace = (held: boolean) => {
      spaceRef.current = held
      setSpaceHeld(held)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isEditable(e.target)) return
      const svg = svgRef.current
      const focused = svg !== null && svg.contains(document.activeElement)
      if (!hovered.current && !focused && !spaceRef.current) return
      e.preventDefault()
      if (!spaceRef.current) setSpace(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spaceRef.current) setSpace(false)
    }
    const onBlur = () => {
      if (spaceRef.current) setSpace(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [svgRef])

  const endPointer = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (!g) return
    const ended = g.kind === 'pan' ? g.pointerId === e.pointerId : g.ids.includes(e.pointerId)
    if (!ended) return
    gesture.current = null
    setPanning(false)
  }

  const handlers = {
    onPointerEnter: () => {
      hovered.current = true
    },
    onPointerLeave: () => {
      hovered.current = false
    },
    onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => {
      const pos = { x: e.clientX, y: e.clientY }
      if (e.pointerType === 'touch') {
        pointers.current.set(e.pointerId, pos)
        capture(e.currentTarget, e.pointerId)
        const touches = [...pointers.current.entries()]
        if (touches.length === 2 && gesture.current === null) {
          const [a, b] = touches as [[number, Pos], [number, Pos]]
          gesture.current = {
            kind: 'pinch',
            ids: [a[0], b[0]],
            from: [a[1], b[1]],
            start: viewRef.current,
          }
          setPanning(true)
        }
        return
      }
      const panButton = (e.button === 0 && spaceRef.current) || e.button === 1
      if (!panButton || gesture.current !== null) return
      e.preventDefault()
      capture(e.currentTarget, e.pointerId)
      gesture.current = { kind: 'pan', pointerId: e.pointerId, last: pos }
      setPanning(true)
    },
    onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => {
      const pos = { x: e.clientX, y: e.clientY }
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, pos)
      const g = gesture.current
      if (!g) return
      const box = boxOf(e.currentTarget)
      if (g.kind === 'pan') {
        if (g.pointerId !== e.pointerId) return
        const dx = pos.x - g.last.x
        const dy = pos.y - g.last.y
        g.last = pos
        setView((v) => panBy(v, box, dx, dy))
        return
      }
      const a = pointers.current.get(g.ids[0])
      const b = pointers.current.get(g.ids[1])
      if (!a || !b) return
      const next = pinchView(g.start, base, box, g.from, [a, b])
      setView(() => next)
    },
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
  }

  return { view, base, spaceHeld, panning, handlers }
}
