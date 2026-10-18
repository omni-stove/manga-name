import type { FocusKind, Panel } from '@manga/schema'
import { FONT_FAMILY } from './backend'
import { type PxPoint, type PxRect, pointToPx } from './geometry'
import { alphabeticY } from './text'

type Ctx = CanvasRenderingContext2D

// 生成プロンプトがこの色の名前で印の意味を説明するので、エディタのテーマに合わせず固定する
const FOCUS_COLORS: Record<FocusKind, string> = {
  face: '#1a8fd6',
  keyObject: '#e0901e',
  sfx: '#8e5bd6',
}
const VECTOR_COLOR = '#2f9e6a'

/** 以下は mm。エディタの焦点とベクトルの見た目に揃える */
const FOCUS_RADIUS = 10
const MIN_RADIUS = 1.5
const CIRCLE_WIDTH = 0.5
const DOT_RADIUS = 0.8
const STRONG_WIDTH = 0.8
const WEAK_WIDTH = 0.4
const HEAD_LENGTH = 2.6
const HEAD_HALF = 1.2
const LABEL_SIZE = 3
const LABEL_GAP = 1

/** 焦点か誘導線があるか。無いコマには配置の印を描かない */
export const hasPlacement = (panel: Panel): boolean =>
  panel.focusPoints.length > 0 || panel.vectors.length > 0

/**
 * コマの配置の印を描く。誘導線は緑の矢印（strong は太く）、焦点は種別の色の円で半径は weight に比例し、
 * 中心に点、円の横にラベルを白で縁取って置く。`rect` はコマを囲む矩形（px）、`mm` は 1mm の px 数。
 * 印は `rect` の外へは出さない。ラベルを描くので、呼ぶ前に loadFonts を済ませておく
 */
export function drawPlacement(ctx: Ctx, panel: Panel, rect: PxRect, mm: number): void {
  const at = (p: { x: number; y: number }) => pointToPx(p, rect)
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.w, rect.h)
  ctx.clip()

  ctx.strokeStyle = VECTOR_COLOR
  ctx.fillStyle = VECTOR_COLOR
  ctx.lineCap = 'round'
  for (const v of panel.vectors) {
    const width = (v.strength === 'strong' ? STRONG_WIDTH : WEAK_WIDTH) * mm
    drawArrow(ctx, at(v.from), at(v.to), Math.max(1, width), mm)
  }

  const fontPx = LABEL_SIZE * mm
  ctx.font = `${fontPx}px "${FONT_FAMILY}"`
  ctx.lineJoin = 'round'
  for (const focus of panel.focusPoints) {
    const c = at(focus.pos)
    const r = Math.max(MIN_RADIUS, FOCUS_RADIUS * focus.weight) * mm
    const color = FOCUS_COLORS[focus.kind]
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = Math.max(1, CIRCLE_WIDTH * mm)
    ctx.beginPath()
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(c.x, c.y, DOT_RADIUS * mm, 0, Math.PI * 2)
    ctx.fill()

    const label = focus.label.replace(/\s+/g, ' ').trim()
    if (label === '') continue
    // 右寄りの焦点はラベルを円の左に置き、コマの外で切れないようにする
    const right = focus.pos.x <= 0.6
    ctx.textAlign = right ? 'left' : 'right'
    const x = right ? c.x + r + LABEL_GAP * mm : c.x - r - LABEL_GAP * mm
    const y = alphabeticY(c.y, fontPx, 'middle')
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = Math.max(1, fontPx * 0.25)
    ctx.strokeText(label, x, y)
    ctx.fillText(label, x, y)
  }
  ctx.restore()
}

function drawArrow(ctx: Ctx, from: PxPoint, to: PxPoint, width: number, mm: number): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return
  const ux = dx / length
  const uy = dy / length
  const head = Math.min(HEAD_LENGTH * mm, length)
  const half = HEAD_HALF * mm
  const base = { x: to.x - ux * head, y: to.y - uy * head }
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(base.x, base.y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(base.x - uy * half, base.y + ux * half)
  ctx.lineTo(base.x + uy * half, base.y - ux * half)
  ctx.closePath()
  ctx.fill()
}
