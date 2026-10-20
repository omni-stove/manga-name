import { type FocusPoint, type ID, type Page, type Patch, sfxFontSize } from '@manga/schema'
import type { Box } from './bubble-shape'
import { findFocus } from './hint-ops'
import type { PagePoint } from './hit-test'
import { layoutUnbroken } from './vertical-text'

/** Shift を押しながら回すときに吸い付く角度（度） */
const SNAP_DEGREES = 15

/** 描き文字の、回す前の組みの大きさ（mm）と、紙面での中心と傾き（度） */
export interface SfxFrame {
  cx: number
  cy: number
  w: number
  h: number
  rotation: number
}

/** コマ panel（ページ座標の矩形）に置いた描き文字の枠 */
export function sfxFrame(focus: FocusPoint, panel: Box): SfxFrame {
  const fontSize = sfxFontSize(focus, panel.w, panel.h)
  const layout = layoutUnbroken(focus.label, fontSize)
  const rows = Math.max(0, ...layout.columns.map((c) => c.length))
  return {
    cx: panel.x + focus.pos.x * panel.w,
    cy: panel.y + focus.pos.y * panel.h,
    w: layout.width,
    h: rows * fontSize,
    rotation: focus.rotation ?? 0,
  }
}

/** 回す前の組みで (x, y) にある点を、枠の傾きだけ中心で回したページ座標 */
export function sfxPoint(frame: SfxFrame, x: number, y: number): PagePoint {
  const t = (frame.rotation * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  return { x: frame.cx + x * cos - y * sin, y: frame.cy + x * sin + y * cos }
}

/** 回転のハンドルの位置。回す前の組みの上端の中央から gap（mm）だけ離した点を、枠と一緒に回す */
export function sfxRotateHandle(frame: SfxFrame, gap: number): PagePoint {
  return sfxPoint(frame, 0, -(frame.h / 2 + gap))
}

/**
 * 中心 center から見て点 p にハンドルを置いたときの傾き（度）。1 度刻みで -180 より大きく 180 以下に収める。
 * snap なら SNAP_DEGREES 刻みにする
 */
export function rotationAt(center: PagePoint, p: PagePoint, snap = false): number {
  // ハンドルは傾き 0 で真上にあるので、真上を 0 度にする
  const degrees = (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI + 90
  const step = snap ? SNAP_DEGREES : 1
  const rounded = Math.round(degrees / step) * step
  const normal = ((((rounded + 180) % 360) + 360) % 360) - 180
  // -180 と 180 は同じ向きなので、180 にそろえる。-0 も 0 にする
  return normal === -180 ? 180 : normal + 0
}

/** 焦点 focusId の傾きを rotation（度）にする Patch。0 は傾きを持たない形にする。変わらないか焦点が無ければ空 */
export function rotateFocusPatch(page: Page, focusId: ID, rotation: number): Patch {
  const at = findFocus(page, focusId)
  const focus = at?.panel.focusPoints[at.index]
  if (!at || !focus) return []
  if (rotation === (focus.rotation ?? 0)) return []
  const path = `/panels/${at.panelIndex}/focusPoints/${at.index}/rotation`
  if (rotation === 0) return [{ op: 'remove', path }]
  // JSON Patch の add は既存のメンバーを置き換えるので、有無を分けずに済む
  return [{ op: 'add', path, value: rotation }]
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
  const panel: Box = { x: 10, y: 20, w: 100, h: 50 }
  const focus = (patch: Partial<FocusPoint>): FocusPoint => ({
    id: 'fp',
    kind: 'sfx',
    label: 'ドドド',
    pos: { x: 0.5, y: 0.4 },
    weight: 0,
    ...patch,
  })

  test('sfxFrame centres on the focus and sizes the unbroken label with the scale', () => {
    // 文字の高さは短辺 50mm の 0.08 で 4mm、倍率 2 で 8mm
    const frame = sfxFrame(focus({ scale: 2, rotation: 30 }), panel)
    expect(frame).toMatchObject({ cx: 60, cy: 40, rotation: 30 })
    expect(frame.w).toBeCloseTo(8)
    expect(frame.h).toBeCloseTo(24)
    const twoColumns = sfxFrame(focus({ label: 'ザッ\nザザッ' }), panel)
    expect(twoColumns.h).toBeCloseTo(12)
    expect(twoColumns.w).toBeCloseTo(4 + 0.8 + 4)
  })

  test('sfxRotateHandle sits above the frame and turns with it', () => {
    const frame = sfxFrame(focus({}), panel)
    const upright = sfxRotateHandle(frame, 3)
    expect(upright.x).toBeCloseTo(60)
    expect(upright.y).toBeCloseTo(40 - 6 - 3)
    const turned = sfxRotateHandle({ ...frame, rotation: 90 }, 3)
    expect(turned.x).toBeCloseTo(69)
    expect(turned.y).toBeCloseTo(40)
  })

  describe('rotationAt', () => {
    const c = { x: 0, y: 0 }

    test('is 0 straight up and grows clockwise', () => {
      expect(rotationAt(c, { x: 0, y: -5 })).toBe(0)
      expect(rotationAt(c, { x: 5, y: 0 })).toBe(90)
      expect(rotationAt(c, { x: -5, y: 0 })).toBe(-90)
      expect(rotationAt(c, { x: 0, y: 5 })).toBe(180)
      expect(rotationAt(c, { x: -0.001, y: 5 })).toBe(180)
      expect(rotationAt(c, { x: 1, y: -1 })).toBe(45)
    })

    test('rounds to whole degrees, or to 15 degrees when snapping', () => {
      const p = { x: Math.sin(0.3), y: -Math.cos(0.3) }
      expect(rotationAt(c, p)).toBe(17)
      expect(rotationAt(c, p, true)).toBe(15)
    })
  })

  describe('rotateFocusPatch', () => {
    test('adds the rotation, and removes it when back to 0', () => {
      expect(rotateFocusPatch(page, 'fp_2_vial', 30)).toEqual([
        { op: 'add', path: '/panels/1/focusPoints/1/rotation', value: 30 },
      ])
      const tilt = (f: FocusPoint) => (f.id === 'fp_2_vial' ? { ...f, rotation: 30 } : f)
      const tilted = {
        ...page,
        panels: page.panels.map((p) => ({ ...p, focusPoints: p.focusPoints.map(tilt) })),
      }
      expect(rotateFocusPatch(tilted, 'fp_2_vial', 0)).toEqual([
        { op: 'remove', path: '/panels/1/focusPoints/1/rotation' },
      ])
      expect(rotateFocusPatch(tilted, 'fp_2_vial', 30)).toEqual([])
    })

    test('is empty when nothing turns or the focus is missing', () => {
      expect(rotateFocusPatch(page, 'fp_2_vial', 0)).toEqual([])
      expect(rotateFocusPatch(page, 'missing', 30)).toEqual([])
    })
  })
}
