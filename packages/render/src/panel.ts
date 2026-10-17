import { cornerAnchor } from '@manga/schema'
import { FONT_FAMILY } from './backend'
import type { PxPoint, PxRect } from './geometry'
import { wrapHorizontal } from './text'

type Ctx = CanvasRenderingContext2D

/** 輪郭を閉じたパスにする */
function tracePolygon(ctx: Ctx, outline: readonly PxPoint[]): void {
  ctx.beginPath()
  outline.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  })
  ctx.closePath()
}

/** 画像をコマを囲む rect に cover で置き、輪郭 outline からはみ出す部分は切る */
export function drawCover(
  ctx: Ctx,
  image: CanvasImageSource,
  rect: PxRect,
  outline: readonly PxPoint[],
): void {
  const iw = 'naturalWidth' in image ? image.naturalWidth : (image as { width: number }).width
  const ih = 'naturalHeight' in image ? image.naturalHeight : (image as { height: number }).height
  if (!(iw > 0 && ih > 0)) return
  const scale = Math.max(rect.w / iw, rect.h / ih)
  const w = iw * scale
  const h = ih * scale
  ctx.save()
  tracePolygon(ctx, outline)
  ctx.clip()
  ctx.drawImage(image, rect.x + (rect.w - w) / 2, rect.y + (rect.h - h) / 2, w, h)
  ctx.restore()
}

export function drawFrame(ctx: Ctx, outline: readonly PxPoint[], lineWidth: number): void {
  ctx.save()
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = '#000'
  ctx.lineJoin = 'miter'
  tracePolygon(ctx, outline)
  ctx.stroke()
  ctx.restore()
}

/**
 * 未生成コマの中身。rect の左上にコマ番号、その下に camera と note を横書きで小さく。
 * 輪郭 outline の外に出る部分は切る
 */
export function drawPlaceholder(
  ctx: Ctx,
  panel: { order: number; camera?: string; note?: string },
  rect: PxRect,
  outline: readonly PxPoint[],
  fontPx: number,
): void {
  const pad = fontPx
  const numberPx = fontPx * 1.8
  ctx.save()
  tracePolygon(ctx, outline)
  ctx.clip()
  ctx.fillStyle = '#000'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.font = `${numberPx}px "${FONT_FAMILY}"`
  ctx.fillText(String(panel.order), rect.x + pad, rect.y + pad)

  ctx.font = `${fontPx}px "${FONT_FAMILY}"`
  const lineHeight = fontPx * 1.4
  let y = rect.y + pad + numberPx * 1.3
  const bottom = rect.y + rect.h - pad
  const text = [panel.camera && `[${panel.camera}]`, panel.note].filter(Boolean).join('\n')
  for (const line of wrapHorizontal(ctx, text, rect.w - pad * 2)) {
    if (y + lineHeight > bottom) break
    ctx.fillText(line, rect.x + pad, y)
    y += lineHeight
  }
  ctx.restore()
}

/** 輪郭の右上のコマ番号。白丸に黒文字 */
export function drawPanelNumber(
  ctx: Ctx,
  order: number,
  outline: readonly PxPoint[],
  fontPx: number,
): void {
  const r = fontPx * 0.9
  const inset = r + fontPx * 0.4
  const { x: cx, y: cy } = cornerAnchor(outline, 'ne', -inset, inset)
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.lineWidth = Math.max(1, fontPx * 0.08)
  ctx.strokeStyle = '#000'
  ctx.stroke()
  ctx.fillStyle = '#000'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${fontPx}px "${FONT_FAMILY}"`
  ctx.fillText(String(order), cx, cy)
  ctx.restore()
}

/** 余白のメモ。コマ番号と camera の行、続けて note を横書きで列挙する */
export function drawNotesMargin(
  ctx: Ctx,
  panels: { order: number; camera?: string; note?: string }[],
  area: PxRect,
  fontPx: number,
): void {
  const pad = fontPx
  const lineHeight = fontPx * 1.5
  const bottom = area.y + area.h - pad
  ctx.save()
  ctx.beginPath()
  ctx.rect(area.x, area.y, area.w, area.h)
  ctx.clip()
  ctx.fillStyle = '#000'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  let y = area.y + pad
  for (const panel of panels) {
    ctx.font = `bold ${fontPx}px "${FONT_FAMILY}"`
    const head = [String(panel.order), panel.camera].filter(Boolean).join(' ')
    for (const line of wrapHorizontal(ctx, head, area.w - pad * 2)) {
      ctx.fillText(line, area.x + pad, y)
      y += lineHeight
    }
    ctx.font = `${fontPx}px "${FONT_FAMILY}"`
    for (const line of wrapHorizontal(ctx, panel.note ?? '', area.w - pad * 2)) {
      ctx.fillText(line, area.x + pad, y)
      y += lineHeight
    }
    y += lineHeight * 0.5
    if (y > bottom) break
  }
  ctx.restore()
}
