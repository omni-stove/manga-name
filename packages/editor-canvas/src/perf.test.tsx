// @vitest-environment jsdom
import {
  type Bubble,
  BubbleSchema,
  fixtures,
  type Page,
  type Panel,
  type Stroke,
} from '@manga/schema'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { EditorCanvas } from './editor-canvas'
import type { EditorCanvasProps } from './types'
import { fitView } from './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 1 フレームの予算（60fps） */
const FRAME_MS = 16
const ROWS = 6
const COLUMNS = 5
const BUBBLES = 20
const MOVES = 120
const SHAPES = BubbleSchema.shape.shape.options

const project = fixtures.samplePage01
const { w: pageW, h: pageH } = project.settings.pageSize

/** 6 行 5 列の 30 コマ。先頭の 20 コマにフキダシを 1 つずつ置き、全コマに画像を採用する */
function bigPage(): Page {
  const panels: Panel[] = []
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const i = panels.length
      const id = `pn_${i + 1}`
      const bubbles: Bubble[] =
        i < BUBBLES
          ? [
              {
                id: `bb_${i + 1}`,
                order: 1,
                text: 'セリフがここに入る。少し長めのセリフ',
                shape: SHAPES[i % SHAPES.length] ?? 'normal',
                pos: { x: 0.5, y: 0.5 },
                size: { w: 0.5, h: 0.6 },
                tail: { x: 0.2, y: 0.95 },
              },
            ]
          : []
      panels.push({
        id,
        order: i + 1,
        rect: {
          x: col / COLUMNS + 0.005,
          y: row / ROWS + 0.005,
          w: 1 / COLUMNS - 0.01,
          h: 1 / ROWS - 0.01,
        },
        bubbles,
        arts: [
          {
            id: `art_${id}`,
            ref: `file:art/${id}.png`,
            provider: 'fake',
            prompt: 'p',
            createdAt: '2026-10-16T00:00:00.000Z',
          },
        ],
        artId: `art_${id}`,
        camera: 'ロング',
        focusPoints: [],
        vectors: [],
      })
    }
  }
  return { id: 'pg_perf', side: 'single', panels, scribbles: [] }
}

const resolveAsset = (ref: string) => Promise.resolve(`data:image/png;base64,${btoa(ref)}`)

const base = fitView(pageW, pageH)
/** 正規化ページ座標に対応する画面座標。要素は 2px / mm */
const clientAt = (nx: number, ny: number) => ({
  x: (nx * pageW - base.x) * 2,
  y: (ny * pageH - base.y) * 2,
})

function pointer(type: string, id: number, at: { x: number; y: number }) {
  // jsdom の PointerEvent の有無に依存しないよう、MouseEvent に pointer の属性を足す
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: at.x,
    clientY: at.y,
  })
  Object.defineProperties(e, { pointerId: { value: id }, pointerType: { value: 'mouse' } })
  return e
}

/** act 込みで 1 イベントを処理しきるまでの ms */
function timed(target: EventTarget, e: Event): number {
  const start = performance.now()
  act(() => {
    target.dispatchEvent(e)
  })
  return performance.now() - start
}

/**
 * 所要時間が 1 フレームに収まることを確かめる。PERF=1（mise run perf）のときだけ測る。
 * 共有ランナーの CPU で所要時間がぶれ、コードと無関係に落ちるため。描き直す要素の数は常に確かめる
 */
function expectWithinFrame(ms: number): void {
  if (process.env.PERF) expect(ms).toBeLessThan(FRAME_MS)
}

const percentile = (xs: number[], p: number) => {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

let unmount: (() => void) | undefined

afterEach(() => {
  unmount?.()
  unmount = undefined
  document.body.replaceChildren()
})

test(`dragging a bubble on ${ROWS * COLUMNS} panels and ${BUBBLES} bubbles stays within ${FRAME_MS}ms per frame`, async () => {
  const page = bigPage()
  const panel = page.panels[7] as Panel
  // pointerup の Patch を親が適用した結果。中身は Patch の検証ではないので、移動後のページを直接作る
  const next: Page = {
    ...page,
    panels: page.panels.map((p) =>
      p.id === panel.id
        ? { ...p, bubbles: p.bubbles.map((b) => ({ ...b, pos: { x: 0.8, y: 0.5 } })) }
        : p,
    ),
  }
  let changed = 0
  const props: EditorCanvasProps = {
    page,
    settings: project.settings,
    characters: project.characters,
    diagnosis: null,
    selection: { kind: 'bubble', id: 'bb_8' },
    tool: 'bubble',
    layers: { reference: true, art: true, scribble: true, hints: true, diagnosis: true },
    generating: new Set(),
    onChange: () => {
      changed++
    },
    onSelect: () => {},
    // 親が毎回作り直す想定。memo が外れないことも測る
    onGenerate: () => {},
    resolveAsset,
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  unmount = () => act(() => root.unmount())
  await act(async () => root.render(<EditorCanvas {...props} />))
  const svg = container.querySelector('svg') as SVGSVGElement
  svg.getBoundingClientRect = () => {
    const width = base.w * 2
    const height = base.h * 2
    return { left: 0, top: 0, x: 0, y: 0, width, height, right: width, bottom: height } as DOMRect
  }
  expect(svg.querySelectorAll('[data-panel-id]')).toHaveLength(ROWS * COLUMNS)
  expect(svg.querySelectorAll('[data-bubble-id]')).toHaveLength(BUBBLES)
  expect(svg.querySelectorAll('image')).toHaveLength(ROWS * COLUMNS)

  // bb_8 は 2 行目 3 列目のコマの中央
  const nx = (dx: number) => panel.rect.x + panel.rect.w * (0.5 + dx)
  const ny = panel.rect.y + panel.rect.h * 0.5
  const pageLayer = svg.querySelector('[data-layer="page"]') as Element
  const mutations: MutationRecord[] = []
  const observer = new MutationObserver((records) => mutations.push(...records))
  observer.observe(pageLayer, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  })

  const frames: number[] = []
  timed(svg, pointer('pointerdown', 1, clientAt(nx(0), ny)))
  for (let i = 1; i <= MOVES; i++) {
    frames.push(timed(svg, pointer('pointermove', 1, clientAt(nx((0.3 * i) / MOVES), ny))))
  }
  await Promise.resolve()
  observer.disconnect()
  expect(svg.querySelector('[data-layer="bubble-tool"][data-draft="bb_8"]')).not.toBeNull()
  // ドラッグ中はページの描画に触らず、破線の下書きだけを描き直す
  expect(mutations).toHaveLength(0)

  const p95 = percentile(frames, 0.95)
  const median = percentile(frames, 0.5)
  console.info(
    `drag: ${MOVES} moves, median ${median.toFixed(2)}ms, p95 ${p95.toFixed(2)}ms, max ${Math.max(...frames).toFixed(2)}ms`,
  )
  expectWithinFrame(p95)

  // pointerup の Patch を親が適用したあとの 1 回の描画も 1 フレームに収め、動かしたフキダシだけを描き直す
  await act(async () => root.render(<EditorCanvas {...props} onGenerate={() => {}} />))
  timed(svg, pointer('pointerup', 1, clientAt(nx(0.3), ny)))
  expect(changed).toBe(1)
  const touched = new Set<Element>()
  const after = new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target instanceof Element ? r.target : r.target.parentElement
      const owner = el?.closest('[data-bubble-id], [data-panel-id], [data-overlay-panel-id]')
      if (owner) touched.add(owner)
    }
  })
  after.observe(pageLayer, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  })
  const start = performance.now()
  act(() => root.render(<EditorCanvas {...props} page={next} onGenerate={() => {}} />))
  const commitMs = performance.now() - start
  await Promise.resolve()
  after.disconnect()
  console.info(`commit after drag: ${commitMs.toFixed(2)}ms`)
  expectWithinFrame(commitMs)
  expect([...touched].map((el) => el.getAttribute('data-bubble-id'))).toEqual(['bb_8'])
})

const STROKES = 500
const STROKE_POINTS = 40

/** 1 ページに 500 本。1 本は 40 点の波線で、ページ全体に散らす */
function scribbledPage(): Page {
  const scribbles: Stroke[] = []
  for (let i = 0; i < STROKES; i++) {
    const x0 = (i % 20) / 20
    const y0 = Math.floor(i / 20) / 25
    scribbles.push({
      id: `st_${i + 1}`,
      points: Array.from({ length: STROKE_POINTS }, (_, j) => ({
        x: x0 + (0.04 * j) / STROKE_POINTS,
        y: y0 + 0.01 * Math.sin(j / 3),
      })),
      width: 0.002,
      color: (['ink', 'red', 'blue'] as const)[i % 3] ?? 'ink',
    })
  }
  return { ...bigPage(), scribbles }
}

test(`drawing on a page with ${STROKES} strokes stays within ${FRAME_MS}ms per frame`, async () => {
  const page = scribbledPage()
  let added: Stroke | undefined
  const props: EditorCanvasProps = {
    page,
    settings: project.settings,
    characters: project.characters,
    diagnosis: null,
    selection: null,
    tool: 'scribble',
    scribbleTool: 'red',
    layers: { reference: true, art: true, scribble: true, hints: true, diagnosis: true },
    generating: new Set(),
    onChange: (patch) => {
      const op = patch[0]
      if (op?.op === 'add') added = op.value as Stroke
    },
    onSelect: () => {},
    onGenerate: () => {},
    resolveAsset,
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  unmount = () => act(() => root.unmount())
  await act(async () => root.render(<EditorCanvas {...props} />))
  const svg = container.querySelector('svg') as SVGSVGElement
  svg.getBoundingClientRect = () => {
    const width = base.w * 2
    const height = base.h * 2
    return { left: 0, top: 0, x: 0, y: 0, width, height, right: width, bottom: height } as DOMRect
  }
  const layer = svg.querySelector('[data-layer="scribble"]') as Element
  expect(layer.querySelectorAll('[data-stroke-id]')).toHaveLength(STROKES)

  const mutations: MutationRecord[] = []
  const observer = new MutationObserver((records) =>
    mutations.push(
      ...records.filter(
        (r) => !(r.target instanceof Element && r.target.hasAttribute('data-live-stroke')),
      ),
    ),
  )
  observer.observe(svg, { subtree: true, childList: true, attributes: true, characterData: true })

  const frames: number[] = []
  timed(svg, pointer('pointerdown', 1, clientAt(0.1, 0.5)))
  for (let i = 1; i <= MOVES; i++) {
    frames.push(timed(svg, pointer('pointermove', 1, clientAt(0.1 + (0.6 * i) / MOVES, 0.5))))
  }
  await Promise.resolve()
  observer.disconnect()
  const live = layer.querySelector('[data-live-stroke]') as SVGPolylineElement
  expect(live.getAttribute('points')?.split(' ').length).toBeGreaterThan(1)
  // 描いている間は描画中の線の points だけを書き換え、React は何も描き直さない
  expect(mutations).toHaveLength(0)

  const p95 = percentile(frames, 0.95)
  const median = percentile(frames, 0.5)
  console.info(
    `scribble: ${MOVES} moves on ${STROKES} strokes, median ${median.toFixed(2)}ms, p95 ${p95.toFixed(2)}ms, max ${Math.max(...frames).toFixed(2)}ms`,
  )
  expectWithinFrame(p95)

  timed(svg, pointer('pointerup', 1, clientAt(0.7, 0.5)))
  expect(added).toBeDefined()
  // pointerup の Patch を親が適用したあとの 1 回の描画も 1 フレームに収め、足した線だけを描く
  const next: Page = { ...page, scribbles: [...page.scribbles, added as Stroke] }
  const after: MutationRecord[] = []
  const commitObserver = new MutationObserver((records) => after.push(...records))
  commitObserver.observe(layer, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  })
  const start = performance.now()
  act(() => root.render(<EditorCanvas {...props} page={next} />))
  const commitMs = performance.now() - start
  await Promise.resolve()
  commitObserver.disconnect()
  console.info(`commit after stroke: ${commitMs.toFixed(2)}ms`)
  expectWithinFrame(commitMs)
  expect(after.flatMap((r) => [...r.addedNodes, ...r.removedNodes])).toEqual([
    layer.querySelector(`[data-stroke-id="${added?.id}"]`),
  ])
  expect(after.filter((r) => r.type !== 'childList')).toHaveLength(0)
})
