// @vitest-environment jsdom
import { fixtures, type Page } from '@manga/schema'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { EditorCanvas } from './editor-canvas'
import type { EditorCanvasProps } from './types'
import { fitView } from './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const project = fixtures.samplePage01
const samplePage = project.episodes[0]?.pages[0] as Page

const fixtureArtUrl = (panelId: string) =>
  new URL(`../../../docs/fixtures/art/${panelId}.png`, import.meta.url).href

/** 全コマに docs/fixtures/art/<panelId>.png を採用したページ */
const pageWithArts: Page = {
  ...samplePage,
  panels: samplePage.panels.map((panel) => ({
    ...panel,
    arts: [
      {
        id: `art_${panel.id}`,
        ref: `file:art/${panel.id}.png`,
        provider: 'fake',
        prompt: 'p',
        createdAt: '2026-10-16T00:00:00.000Z',
      },
    ],
    artId: `art_${panel.id}`,
  })),
}

const resolveFixture = (ref: string) =>
  Promise.resolve(fixtureArtUrl(ref.replace(/^file:art\//, '').replace(/\.png$/, '')))

const defaults: EditorCanvasProps = {
  page: samplePage,
  settings: project.settings,
  characters: project.characters,
  diagnosis: null,
  selection: null,
  tool: 'select',
  layers: { reference: true, art: true, scribble: true, hints: true, diagnosis: true },
  generating: new Set(),
  onChange: () => {},
  onSelect: () => {},
  resolveAsset: resolveFixture,
}

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing')
  return value
}

async function render(overrides: Partial<EditorCanvasProps> = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(<EditorCanvas {...defaults} {...overrides} />))
  return must(container.querySelector('svg'))
}

describe('drawing the fixture', () => {
  test('six panels, three bubbles, vertical dialogue', async () => {
    const svg = await render()
    expect(svg.querySelectorAll('[data-panel-id]')).toHaveLength(6)
    expect(svg.querySelectorAll('[data-panel-number]')).toHaveLength(6)
    expect(svg.querySelectorAll('[data-bubble-id]')).toHaveLength(3)
    const lines = [...svg.querySelectorAll('text[writing-mode="vertical-rl"]')]
    expect(lines).toHaveLength(3)
    expect(lines.map((t) => t.textContent).sort()).toEqual(['……', '……？', '……芽が'].sort())
  })

  test('panels without art show camera and note in grey, and no image', async () => {
    const svg = await render()
    expect(svg.querySelectorAll('image')).toHaveLength(0)
    const first = must(svg.querySelector('[data-panel-id="pn_1"] [data-placeholder]'))
    expect(first.textContent).toContain('[ロング]')
    expect(first.textContent).toContain('ガラス結晶の森')
  })

  test('the selected panel gets a blue frame', async () => {
    const svg = await render({ selection: { kind: 'panel', id: 'pn_2' } })
    const strokes = [...svg.querySelectorAll('[data-panel-id="pn_2"] > rect')].map((r) =>
      r.getAttribute('stroke'),
    )
    expect(strokes).toContain('#2563eb')
  })
})

describe('art', () => {
  test('arts are drawn as <image> clipped to the panel', async () => {
    const resolveAsset = vi.fn(resolveFixture)
    const svg = await render({ page: pageWithArts, resolveAsset })
    const images = [...svg.querySelectorAll('image')]
    expect(images).toHaveLength(6)
    expect(resolveAsset).toHaveBeenCalledTimes(6)
    for (const panel of pageWithArts.panels) {
      const image = must(svg.querySelector(`[data-panel-id="${panel.id}"] image`))
      expect(image.getAttribute('href')).toBe(fixtureArtUrl(panel.id))
      expect(image.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice')
      const id = must(image.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/)?.[1])
      const clip = must(svg.querySelector(`clipPath[id="${id}"] rect`))
      expect(clip.getAttribute('width')).toBe(image.getAttribute('width'))
      expect(clip.getAttribute('height')).toBe(image.getAttribute('height'))
    }
  })

  test('a failed resolve falls back to the placeholder with an error', async () => {
    const svg = await render({
      page: pageWithArts,
      resolveAsset: (ref) =>
        ref.includes('pn_3') ? Promise.reject(new Error('gone')) : resolveFixture(ref),
    })
    expect(svg.querySelectorAll('image')).toHaveLength(5)
    const panel = must(svg.querySelector('[data-panel-id="pn_3"]'))
    expect(panel.getAttribute('data-art-error')).toBe('true')
    expect(panel.textContent).toContain('画像を読み込めません')
  })

  test('layers.art = false hides art without resolving it', async () => {
    const resolveAsset = vi.fn(resolveFixture)
    const svg = await render({
      page: pageWithArts,
      resolveAsset,
      layers: { ...defaults.layers, art: false },
    })
    expect(svg.querySelectorAll('image')).toHaveLength(0)
    expect(resolveAsset).not.toHaveBeenCalled()
  })
})

test('panels in generating get a spinner', async () => {
  const svg = await render({ generating: new Set(['pn_2', 'pn_5']) })
  expect(svg.querySelectorAll('[data-spinner]')).toHaveLength(2)
  expect(svg.querySelector('[data-overlay-panel-id="pn_2"] [data-spinner]')).not.toBeNull()
  expect(svg.querySelector('[data-overlay-panel-id="pn_5"] [data-spinner]')).not.toBeNull()
  expect(svg.querySelector('[data-overlay-panel-id="pn_1"] [data-spinner]')).toBeNull()
})

test('the generate button calls onGenerate and is hidden while generating', async () => {
  const onGenerate = vi.fn()
  const svg = await render({ onGenerate, generating: new Set(['pn_1']) })
  expect(svg.querySelector('[data-overlay-panel-id="pn_1"] .ec-generate')).toBeNull()
  const button = must(svg.querySelector('[data-overlay-panel-id="pn_4"] .ec-generate'))
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(onGenerate).toHaveBeenCalledWith('pn_4')
})

const base = fitView(project.settings.pageSize.w, project.settings.pageSize.h)

/** base と同じ縦横比で 2px / mm になる大きさに固定する */
function layout(svg: SVGSVGElement) {
  const width = base.w * 2
  const height = base.h * 2
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, x: 0, y: 0, width, height, right: width, bottom: height }) as DOMRect
}

/** layout 後の、正規化ページ座標に対応する画面座標 */
const clientAt = (nx: number, ny: number) => ({
  x: (nx * project.settings.pageSize.w - base.x) * 2,
  y: (ny * project.settings.pageSize.h - base.y) * 2,
})

const viewBox = (svg: SVGSVGElement) => must(svg.getAttribute('viewBox')).split(' ').map(Number)

function pointer(
  type: string,
  init: { id: number; x: number; y: number; button?: number; pointerType?: string },
) {
  // jsdom の PointerEvent の有無に依存しないよう、MouseEvent に pointer の属性を足す
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.x,
    clientY: init.y,
  })
  Object.defineProperties(e, {
    pointerId: { value: init.id },
    pointerType: { value: init.pointerType ?? 'mouse' },
  })
  return e
}

const fire = (target: EventTarget, e: Event) =>
  act(() => {
    target.dispatchEvent(e)
  })

/** 画面座標 at でクリックする */
function click(svg: SVGSVGElement, at: { x: number; y: number }) {
  fire(svg, pointer('pointerdown', { id: 1, ...at }))
  fire(svg, pointer('pointerup', { id: 1, ...at }))
}

const key = (svg: SVGSVGElement, init: KeyboardEventInit) => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  fire(svg, e)
  return e
}

describe('selection', () => {
  test('clicking a panel, a bubble and the background selects each', async () => {
    const onSelect = vi.fn()
    const svg = await render({ onSelect })
    layout(svg)
    click(svg, clientAt(0.75, 0.4))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'panel', id: 'pn_2' })
    click(svg, clientAt(0.85 * 0.48, 0.275 + 0.25 * 0.23))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'bubble', id: 'bb_3' })
    // 何も選んでいないときに背景を押しても、選択は変わらないので知らせない
    click(svg, { x: -10, y: -10 })
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  test('clicking the background with a selection selects nothing', async () => {
    const onSelect = vi.fn()
    const svg = await render({ onSelect, selection: { kind: 'bubble', id: 'bb_3' } })
    layout(svg)
    click(svg, { x: -10, y: -10 })
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  test('a drag and a Space pan do not select', async () => {
    const onSelect = vi.fn()
    const svg = await render({ onSelect })
    layout(svg)
    const from = clientAt(0.75, 0.4)
    fire(svg, pointer('pointerdown', { id: 1, ...from }))
    fire(svg, pointer('pointermove', { id: 1, x: from.x + 30, y: from.y }))
    fire(svg, pointer('pointerup', { id: 1, x: from.x + 30, y: from.y }))
    fire(svg, pointer('pointerover', { id: 1, ...from }))
    fire(window, new KeyboardEvent('keydown', { code: 'Space', key: ' ', cancelable: true }))
    click(svg, from)
    fire(window, new KeyboardEvent('keyup', { code: 'Space', key: ' ' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('hovering highlights the element under the cursor, but not the selected one', async () => {
    const svg = await render({ selection: { kind: 'panel', id: 'pn_2' } })
    layout(svg)
    const highlighted = () =>
      svg.querySelector('[data-layer="highlight"]')?.getAttribute('data-hovered-id') ?? null
    fire(svg, pointer('pointermove', { id: 1, ...clientAt(0.5, 0.1) }))
    expect(highlighted()).toBe('pn_1')
    fire(svg, pointer('pointermove', { id: 1, ...clientAt(0.75, 0.4) }))
    expect(highlighted()).toBeNull()
    fire(svg, pointer('pointermove', { id: 1, ...clientAt(0.92, 0.22 * 0.26) }))
    expect(highlighted()).toBe('bb_1')
    expect(svg.querySelector('[data-layer="highlight"] path')).not.toBeNull()
    // React の onPointerLeave は pointerout で判定する
    fire(svg, pointer('pointerout', { id: 1, x: -10, y: -10 }))
    expect(highlighted()).toBeNull()
  })
})

describe('editing the selection from the keyboard', () => {
  test('Delete emits a remove patch rooted at the page and clears the selection', async () => {
    const onChange = vi.fn()
    const onSelect = vi.fn()
    const svg = await render({ onChange, onSelect, selection: { kind: 'panel', id: 'pn_2' } })
    const e = key(svg, { key: 'Delete' })
    expect(e.defaultPrevented).toBe(true)
    expect(onChange).toHaveBeenCalledWith([{ op: 'remove', path: '/panels/1' }])
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  test('Backspace removes a bubble inside its panel', async () => {
    const onChange = vi.fn()
    const svg = await render({ onChange, selection: { kind: 'bubble', id: 'bb_6' } })
    key(svg, { key: 'Backspace' })
    expect(onChange).toHaveBeenCalledWith([{ op: 'remove', path: '/panels/5/bubbles/0' }])
  })

  test('arrow keys move by 0.01, Shift by 0.1, and stay inside the page', async () => {
    const onChange = vi.fn()
    const svg = await render({ onChange, selection: { kind: 'panel', id: 'pn_2' } })
    key(svg, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith([
      { op: 'replace', path: '/panels/1/rect/y', value: 0.285 },
    ])
    key(svg, { key: 'ArrowLeft', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith([
      { op: 'replace', path: '/panels/1/rect/x', value: 0.4 },
    ])
    key(svg, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  test('a bubble moves with its tail', async () => {
    const onChange = vi.fn()
    const svg = await render({ onChange, selection: { kind: 'bubble', id: 'bb_3' } })
    key(svg, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith([
      { op: 'replace', path: '/panels/2/bubbles/0/pos/y', value: 0.24 },
      { op: 'replace', path: '/panels/2/bubbles/0/tail/y', value: 0.37 },
    ])
  })

  test('Escape clears the selection; keys from inner controls and without a selection do nothing', async () => {
    const onChange = vi.fn()
    const onSelect = vi.fn()
    const svg = await render({ onChange, onSelect, onGenerate: () => {} })
    key(svg, { key: 'Delete' })
    key(svg, { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
    const button = must(svg.querySelector('.ec-generate'))
    act(() => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    })
    expect(onChange).not.toHaveBeenCalled()
    key(svg, { key: 'Escape' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('Escape with a selection selects nothing', async () => {
    const onSelect = vi.fn()
    const svg = await render({ onSelect, selection: { kind: 'bubble', id: 'bb_1' } })
    key(svg, { key: 'Escape' })
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})

describe('zoom and pan', () => {
  test('starts fitted to the page', async () => {
    const svg = await render()
    expect(viewBox(svg)).toEqual([base.x, base.y, base.w, base.h])
    expect(svg.getAttribute('data-zoom')).toBe('1.000')
  })

  test('wheel zooms around the cursor', async () => {
    const svg = await render()
    layout(svg)
    const e = new WheelEvent('wheel', {
      deltaY: -200,
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    })
    fire(svg, e)
    expect(e.defaultPrevented).toBe(true)
    expect(Number(svg.getAttribute('data-zoom'))).toBeGreaterThan(1)
    const [x, y, w] = viewBox(svg) as [number, number, number]
    // カーソル下の点（ページ座標）が動かない
    expect(x + (100 / (base.w * 2)) * w).toBeCloseTo(base.x + 50)
    expect(y + (100 / (base.w * 2)) * w).toBeCloseTo(base.y + 50)
  })

  test('Space drag pans; a plain drag does not', async () => {
    const svg = await render()
    layout(svg)
    fire(svg, pointer('pointerdown', { id: 1, x: 100, y: 100 }))
    fire(svg, pointer('pointermove', { id: 1, x: 140, y: 120 }))
    fire(svg, pointer('pointerup', { id: 1, x: 140, y: 120 }))
    expect(viewBox(svg)).toEqual([base.x, base.y, base.w, base.h])

    fire(svg, pointer('pointerover', { id: 1, x: 100, y: 100 }))
    const space = new KeyboardEvent('keydown', { code: 'Space', key: ' ', cancelable: true })
    fire(window, space)
    expect(space.defaultPrevented).toBe(true)
    fire(svg, pointer('pointerdown', { id: 1, x: 100, y: 100 }))
    fire(svg, pointer('pointermove', { id: 1, x: 140, y: 120 }))
    fire(svg, pointer('pointerup', { id: 1, x: 140, y: 120 }))
    fire(window, new KeyboardEvent('keyup', { code: 'Space', key: ' ' }))
    const [x, y, w, h] = viewBox(svg) as [number, number, number, number]
    expect(x).toBeCloseTo(base.x - 20)
    expect(y).toBeCloseTo(base.y - 10)
    expect([w, h]).toEqual([base.w, base.h])
  })

  test('Space is left alone while typing in a text field', async () => {
    const svg = await render()
    fire(svg, pointer('pointerover', { id: 1, x: 100, y: 100 }))
    const input = document.createElement('input')
    document.body.append(input)
    const space = new KeyboardEvent('keydown', {
      code: 'Space',
      key: ' ',
      bubbles: true,
      cancelable: true,
    })
    fire(input, space)
    expect(space.defaultPrevented).toBe(false)
  })

  test('two-finger pinch zooms and pans', async () => {
    const svg = await render()
    layout(svg)
    const touch = { pointerType: 'touch' }
    fire(svg, pointer('pointerdown', { id: 1, x: 100, y: 200, ...touch }))
    fire(svg, pointer('pointerdown', { id: 2, x: 200, y: 200, ...touch }))
    fire(svg, pointer('pointermove', { id: 2, x: 300, y: 200, ...touch }))
    expect(svg.getAttribute('data-zoom')).toBe('2.000')
    fire(svg, pointer('pointerup', { id: 2, x: 300, y: 200, ...touch }))
    fire(svg, pointer('pointermove', { id: 1, x: 0, y: 0, ...touch }))
    expect(svg.getAttribute('data-zoom')).toBe('2.000')
  })
})
