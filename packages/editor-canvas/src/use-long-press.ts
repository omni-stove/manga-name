import { type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef } from 'react'
import { CLICK_SLOP } from './use-selection'

type Pos = { x: number; y: number }

/** 長押しとみなすまでの ms */
export const LONG_PRESS_MS = 500

interface Press {
  pointerId: number
  from: Pos
  el: SVGSVGElement
  timer: ReturnType<typeof setTimeout>
  fired: boolean
}

/**
 * タッチの長押しを右クリックの代わりにする。1 本指で押して CLICK_SLOP 以内のまま LONG_PRESS_MS 経つか、
 * その間に OS が contextmenu を出したら、押した位置で `onLongPress` を 1 回呼ぶ。
 * 動く、離す、2 本目の指が来るのいずれかで取り消す。
 * 呼んだあと指を離すまで、その指のイベントには `held` が true を返す
 */
export function useLongPress(onLongPress: (el: SVGSVGElement, at: Pos) => void) {
  const press = useRef<Press | null>(null)
  // 押してから発火までに親が渡し直した最新の処理を呼ぶ
  const callback = useRef(onLongPress)
  useLayoutEffect(() => {
    callback.current = onLongPress
  })
  useEffect(() => () => clearTimeout(press.current?.timer), [])

  const clear = () => {
    clearTimeout(press.current?.timer)
    press.current = null
  }
  const fire = () => {
    const p = press.current
    if (!p || p.fired) return
    clearTimeout(p.timer)
    p.fired = true
    callback.current(p.el, p.from)
  }

  return {
    onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
      if (e.pointerType !== 'touch') return
      if (press.current) {
        // 長押しが済んだ後に足した指では取り消さず、最初の指を離すまで握ったままにする
        if (!press.current.fired) clear()
        return
      }
      if (e.isPrimary === false) return
      press.current = {
        pointerId: e.pointerId,
        from: { x: e.clientX, y: e.clientY },
        el: e.currentTarget,
        timer: setTimeout(fire, LONG_PRESS_MS),
        fired: false,
      }
    },
    onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
      const p = press.current
      if (!p || p.fired || p.pointerId !== e.pointerId) return
      if (Math.hypot(e.clientX - p.from.x, e.clientY - p.from.y) > CLICK_SLOP) clear()
    },
    /** 指が離れたか取り消されたら呼ぶ。長押しが済んだ指なら true */
    end(e: ReactPointerEvent<SVGSVGElement>): boolean {
      const p = press.current
      if (!p || p.pointerId !== e.pointerId) return false
      clear()
      return p.fired
    },
    held(e: ReactPointerEvent<SVGSVGElement>): boolean {
      const p = press.current
      return p?.fired === true && p.pointerId === e.pointerId
    },
    /**
     * contextmenu を受けたら呼ぶ。タッチで押している最中なら長押しとして扱って true を返す。
     * Android は長押しで contextmenu を出すので、タイマーと二重に開かないようここでまとめる
     */
    contextMenu(): boolean {
      if (!press.current) return false
      fire()
      return true
    },
  }
}
