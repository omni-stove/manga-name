import type { ID, Panel, ReadingDirection } from '@manga/schema'

/** 上端の差がこの値以下の Panel は同じ段とみなす */
const ROW_TOLERANCE = 0.03

/** 上端の差は 2 進小数で丸まる（0.13 - 0.1 > 0.03）ので、閾値ちょうどの差を仕様どおり同じ段に入れる余裕 */
const ROW_EPSILON = 1e-9

/**
 * Panel の配置から読み順を推定して id を返す。
 * 上端が近い（差 0.03 以下）Panel を同じ段とし、段を上から、段内は rtl なら右から左、ltr なら左から右に並べる。
 * 入力は変更しない。
 */
export function inferReadingOrder(panels: readonly Panel[], direction: ReadingDirection): ID[] {
  const byTop = [...panels].sort((a, b) => a.rect.y - b.rect.y)

  const rows: Panel[][] = []
  let rowTop = 0
  for (const panel of byTop) {
    const row = rows.at(-1)
    // 段の基準は段の先頭の上端に固定する。直前の Panel との差で判定すると段が連鎖して伸びる
    if (row && panel.rect.y - rowTop <= ROW_TOLERANCE + ROW_EPSILON) {
      row.push(panel)
    } else {
      rows.push([panel])
      rowTop = panel.rect.y
    }
  }

  const centreX = (p: Panel) => p.rect.x + p.rect.w / 2
  return rows.flatMap((row) =>
    row
      .sort((a, b) => (direction === 'rtl' ? centreX(b) - centreX(a) : centreX(a) - centreX(b)))
      .map((p) => p.id),
  )
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  const panel = (id: string, x: number, y: number): Panel =>
    ({ id, rect: { x, y, w: 0.4, h: 0.4 } }) as Panel

  const grid = [
    panel('c', 0.05, 0.5),
    panel('b', 0.05, 0),
    panel('a', 0.55, 0),
    panel('d', 0.55, 0.5),
  ]

  test('rtl reads each row right to left, top to bottom', () => {
    expect(inferReadingOrder(grid, 'rtl')).toEqual(['a', 'b', 'd', 'c'])
  })

  test('ltr reads each row left to right', () => {
    expect(inferReadingOrder(grid, 'ltr')).toEqual(['b', 'a', 'c', 'd'])
  })

  test('tops differing by 0.03 share a row; beyond that the upper one comes first', () => {
    const right = panel('right', 0.55, 0)
    expect(inferReadingOrder([panel('left', 0.05, 0.03), right], 'rtl')).toEqual(['right', 'left'])
    expect(inferReadingOrder([panel('left', 0.05, 0.031), right], 'rtl')).toEqual(['right', 'left'])
    const separate = [panel('left', 0.05, 0), panel('right', 0.55, 0.031)]
    expect(inferReadingOrder(separate, 'rtl')).toEqual(['left', 'right'])
  })

  test('a difference of exactly 0.03 from a non-zero top shares a row despite rounding', () => {
    const panels = [panel('left', 0.05, 0.1), panel('right', 0.55, 0.13)]
    expect(inferReadingOrder(panels, 'rtl')).toEqual(['right', 'left'])
  })

  test('does not mutate frozen input', () => {
    const panels = Object.freeze([
      Object.freeze(panel('a', 0.55, 0)),
      Object.freeze(panel('b', 0.05, 0)),
    ])
    expect(inferReadingOrder(panels, 'rtl')).toEqual(['a', 'b'])
  })
}
