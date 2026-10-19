import {
  fitBubblesPatch,
  type Selection,
  type SplitAxis,
  splitPanelPatch,
  type Tool,
} from '@manga/editor-canvas'
import { m } from '@manga/i18n'
import { BUBBLE_SHAPES, FOCUS_KINDS } from '@manga/inspector'
import { type Bubble, type Page, type Patch, type ProjectSettings, pageSizeOf } from '@manga/schema'
import type { ContextMenuItem, SegmentedOption } from '@manga/ui'
import { findBubble, findFocus, findPanel, findVector } from './inspector-ops'

type MenuItems = (ContextMenuItem | 'separator')[]
type Target = NonNullable<Selection>

export interface ElementMenuContext {
  page: Page
  settings: Pick<ProjectSettings, 'pageSize' | 'direction'>
  /** 出してよいツール。キーの表記もここから引く */
  tools: readonly SegmentedOption<Tool>[]
  /** `target` の要素 root の Patch を当てる */
  edit(label: string, target: Target, patch: Patch): void
  /** 当てる時点のページから page root の Patch を組んで当てる */
  editPage(label: string, build: (page: Page) => Patch): void
  remove(target: Target): void
  setTool(tool: Tool): void
  /** フキダシの形を選ぶメニューに切り替える */
  openShapes(): void
}

/** 並びの中で、order が `order` のすぐ前とすぐ後の要素の order。端なら undefined */
function neighborOrders(
  items: readonly { order: number }[],
  order: number,
): { prev?: number; next?: number } {
  let prev: number | undefined
  let next: number | undefined
  for (const item of items) {
    if (item.order < order && (prev === undefined || item.order > prev)) prev = item.order
    if (item.order > order && (next === undefined || item.order < next)) next = item.order
  }
  return { prev, next }
}

const reorder = (order: number): Patch => [{ op: 'replace', path: '/order', value: order }]

/** 読み順を隣と入れ替える 2 項目。`replace /order` は inspector-ops が相手と入れ替える */
function orderItems(
  labels: { earlier: string; later: string },
  items: readonly { order: number }[],
  order: number,
  move: (label: string, patch: Patch) => void,
): ContextMenuItem[] {
  const { prev, next } = neighborOrders(items, order)
  return [
    {
      label: labels.earlier,
      disabled: prev === undefined,
      onSelect: () => prev !== undefined && move(labels.earlier, reorder(prev)),
    },
    {
      label: labels.later,
      disabled: next === undefined,
      onSelect: () => next !== undefined && move(labels.later, reorder(next)),
    },
  ]
}

/** ツールを選ぶ項目。今のツールに印を付ける */
export function toolMenuItems(
  tools: readonly SegmentedOption<Tool>[],
  current: Tool,
  setTool: (tool: Tool) => void,
): ContextMenuItem[] {
  return tools.map((t) => ({
    label: t.label,
    shortcut: t.shortcut,
    checked: t.value === current,
    onSelect: () => setTool(t.value),
  }))
}

/** 要素の位置をロックするか外す */
export function setLocked(ctx: Pick<ElementMenuContext, 'edit'>, target: Target, locked: boolean) {
  if (locked) {
    ctx.edit(m.web_canvas_menu_history_lock(), target, [
      { op: 'add', path: '/locked', value: true },
    ])
  } else {
    ctx.edit(m.web_canvas_menu_history_unlock(), target, [{ op: 'remove', path: '/locked' }])
  }
}

/** 要素を右クリックしたときの、その要素への操作。要素がもう無ければ空 */
export function elementMenuItems(target: Target, ctx: ElementMenuContext): MenuItems {
  const remove: ContextMenuItem = {
    label: m.remove(),
    shortcut: 'Delete',
    onSelect: () => ctx.remove(target),
  }
  const toolItem = (tool: Tool, label: string): ContextMenuItem[] => {
    const option = ctx.tools.find((t) => t.value === tool)
    return option ? [{ label, shortcut: option.shortcut, onSelect: () => ctx.setTool(tool) }] : []
  }
  const move = (label: string, patch: Patch) => ctx.edit(label, target, patch)
  const lock = (locked: boolean | undefined): ContextMenuItem => ({
    label: m.web_canvas_menu_lock(),
    checked: locked === true,
    onSelect: () => setLocked(ctx, target, !locked),
  })

  if (target.kind === 'panel') {
    const found = findPanel(ctx.page, target.id)
    if (!found) return []
    const split = (axis: SplitAxis, label: string): ContextMenuItem => {
      const build = (page: Page) =>
        fitBubblesPatch(
          splitPanelPatch(page, target.id, axis, ctx.settings.direction),
          pageSizeOf(page, ctx.settings.pageSize),
        )
      return {
        label,
        disabled: build(ctx.page).length === 0,
        onSelect: () => ctx.editPage(label, build),
      }
    }
    return [
      // ハンドルでのリサイズと頂点の移動は panel ツールにしか無いので、そこへ切り替える
      ...(found.panel.locked ? [] : toolItem('panel', m.web_canvas_menu_panel_resize())),
      split('vertical', m.web_canvas_menu_panel_split_vertical()),
      split('horizontal', m.web_canvas_menu_panel_split_horizontal()),
      'separator',
      ...toolItem('bubble', m.web_canvas_menu_place_bubble()),
      ...toolItem('focus', m.web_canvas_menu_place_focus()),
      'separator',
      ...orderItems(
        { earlier: m.web_canvas_menu_panel_earlier(), later: m.web_canvas_menu_panel_later() },
        ctx.page.panels,
        found.panel.order,
        move,
      ),
      'separator',
      lock(found.panel.locked),
      remove,
    ]
  }
  if (target.kind === 'bubble') {
    const found = findBubble(ctx.page, target.id)
    if (!found) return []
    const shape = BUBBLE_SHAPES.find((s) => s.value === found.bubble.shape)
    return [
      {
        label: m.web_canvas_menu_bubble_shape({ shape: shape?.label ?? found.bubble.shape }),
        onSelect: ctx.openShapes,
      },
      'separator',
      ...orderItems(
        { earlier: m.web_canvas_menu_bubble_earlier(), later: m.web_canvas_menu_bubble_later() },
        found.panel.bubbles,
        found.bubble.order,
        move,
      ),
      'separator',
      lock(found.bubble.locked),
      remove,
    ]
  }
  if (target.kind === 'focus') {
    const found = findFocus(ctx.page, target.id)
    if (!found) return []
    return [
      ...FOCUS_KINDS.map((k) => ({
        label: k.label,
        checked: k.value === found.focus.kind,
        onSelect: () =>
          k.value !== found.focus.kind &&
          ctx.edit(m.web_canvas_menu_history_change_focus_kind(), target, [
            { op: 'replace', path: '/kind', value: k.value },
          ]),
      })),
      'separator',
      lock(found.focus.locked),
      remove,
    ]
  }
  const found = findVector(ctx.page, target.id)
  if (!found) return []
  return [lock(found.vector.locked), remove]
}

/** フキダシの形を選ぶ項目。今の形に印を付ける */
export function shapeMenuItems(
  bubble: Pick<Bubble, 'id' | 'shape'>,
  ctx: Pick<ElementMenuContext, 'edit'>,
): ContextMenuItem[] {
  return BUBBLE_SHAPES.map((s) => ({
    label: s.label,
    checked: s.value === bubble.shape,
    onSelect: () =>
      s.value !== bubble.shape &&
      ctx.edit(m.web_canvas_menu_history_change_bubble_shape(), { kind: 'bubble', id: bubble.id }, [
        { op: 'replace', path: '/shape', value: s.value },
      ]),
  }))
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page

  const settings = fixtures.samplePage01.settings
  const contextOf = (overrides: Partial<ElementMenuContext> = {}): ElementMenuContext => ({
    page,
    settings,
    tools: [
      { value: 'select', label: '選択', shortcut: 'v' },
      { value: 'panel', label: 'コマ', shortcut: 'p' },
      { value: 'bubble', label: 'フキダシ', shortcut: 'b' },
    ],
    edit: vi.fn(),
    editPage: vi.fn(),
    remove: vi.fn(),
    setTool: vi.fn(),
    openShapes: vi.fn(),
    ...overrides,
  })
  const item = (items: MenuItems, label: string) => {
    const found = items.find((i): i is ContextMenuItem => i !== 'separator' && i.label === label)
    if (!found) throw new Error(`no item ${label}`)
    return found
  }

  test('neighborOrders skips gaps and is undefined at the ends', () => {
    const items = [{ order: 1 }, { order: 4 }, { order: 2 }]
    expect(neighborOrders(items, 2)).toEqual({ prev: 1, next: 4 })
    expect(neighborOrders(items, 1)).toEqual({ prev: undefined, next: 2 })
    expect(neighborOrders(items, 4)).toEqual({ prev: 2, next: undefined })
  })

  describe('elementMenuItems', () => {
    test('a panel offers the tools it may switch to, reading order and removal', () => {
      const panel = page.panels.find((p) => p.order === 1)
      if (!panel) throw new Error('fixture に読み順 1 のコマがない')
      const ctx = contextOf()
      const items = elementMenuItems({ kind: 'panel', id: panel.id }, ctx)
      expect(item(items, m.web_canvas_menu_place_bubble()).shortcut).toBe('b')
      // focus ツールを出してよい一覧に無いので出さない
      expect(() => item(items, m.web_canvas_menu_place_focus())).toThrow()
      expect(item(items, m.web_canvas_menu_panel_earlier()).disabled).toBe(true)
      item(items, m.web_canvas_menu_panel_later()).onSelect()
      expect(ctx.edit).toHaveBeenCalledWith(
        m.web_canvas_menu_panel_later(),
        { kind: 'panel', id: panel.id },
        [{ op: 'replace', path: '/order', value: 2 }],
      )
      item(items, m.remove()).onSelect()
      expect(ctx.remove).toHaveBeenCalledWith({ kind: 'panel', id: panel.id })
      item(items, m.web_canvas_menu_panel_resize()).onSelect()
      expect(ctx.setTool).toHaveBeenCalledWith('panel')
    })

    test('splitting a panel builds the patch from the page at the time it is applied', () => {
      const panel = page.panels[0]
      if (!panel) throw new Error('fixture にコマがない')
      const ctx = contextOf()
      const split = item(
        elementMenuItems({ kind: 'panel', id: panel.id }, ctx),
        m.web_canvas_menu_panel_split_vertical(),
      )
      expect(split.disabled).toBe(false)
      split.onSelect()
      const [label, build] = vi.mocked(ctx.editPage).mock.calls[0] ?? []
      expect(label).toBe(m.web_canvas_menu_panel_split_vertical())
      expect(build?.({ ...page, panels: [] })).toEqual([])
      expect(build?.(page).some((op) => op.op === 'add' && op.path === '/panels/1')).toBe(true)
    })

    test('a locked panel cannot be resized from the menu', () => {
      const panel = page.panels[0]
      if (!panel) throw new Error('fixture にコマがない')
      const locked = {
        ...page,
        panels: page.panels.map((p) => (p.id === panel.id ? { ...p, locked: true } : p)),
      }
      const items = elementMenuItems({ kind: 'panel', id: panel.id }, contextOf({ page: locked }))
      expect(() => item(items, m.web_canvas_menu_panel_resize())).toThrow()
    })

    test('a bubble names its shape and opens the shape menu', () => {
      const ctx = contextOf()
      const items = elementMenuItems({ kind: 'bubble', id: 'bb_3' }, ctx)
      const shape = items[0]
      if (shape === 'separator' || !shape) throw new Error('先頭が形の項目でない')
      expect(shape.label).toBe(m.web_canvas_menu_bubble_shape({ shape: m.bubble_shape_normal() }))
      shape.onSelect()
      expect(ctx.openShapes).toHaveBeenCalled()
    })

    test('locking toggles the locked flag of the element', () => {
      const ctx = contextOf()
      item(
        elementMenuItems({ kind: 'bubble', id: 'bb_3' }, ctx),
        m.web_canvas_menu_lock(),
      ).onSelect()
      expect(ctx.edit).toHaveBeenCalledWith(
        m.web_canvas_menu_history_lock(),
        { kind: 'bubble', id: 'bb_3' },
        [{ op: 'add', path: '/locked', value: true }],
      )

      const locked = {
        ...page,
        panels: page.panels.map((p) => ({
          ...p,
          bubbles: p.bubbles.map((b) => (b.id === 'bb_3' ? { ...b, locked: true } : b)),
        })),
      }
      const lockedCtx = contextOf({ page: locked })
      const lockItem = item(
        elementMenuItems({ kind: 'bubble', id: 'bb_3' }, lockedCtx),
        m.web_canvas_menu_lock(),
      )
      expect(lockItem.checked).toBe(true)
      lockItem.onSelect()
      expect(lockedCtx.edit).toHaveBeenCalledWith(
        m.web_canvas_menu_history_unlock(),
        { kind: 'bubble', id: 'bb_3' },
        [{ op: 'remove', path: '/locked' }],
      )
    })

    test('an element that is gone has no items', () => {
      expect(elementMenuItems({ kind: 'bubble', id: 'nope' }, contextOf())).toEqual([])
    })
  })

  test('shapeMenuItems checks the current shape and changes only to another', () => {
    const edit = vi.fn()
    const items = shapeMenuItems({ id: 'bb_3', shape: 'normal' }, { edit })
    expect(items.filter((i) => i.checked).map((i) => i.label)).toEqual([m.bubble_shape_normal()])
    item(items, m.bubble_shape_normal()).onSelect()
    expect(edit).not.toHaveBeenCalled()
    item(items, m.bubble_shape_shout()).onSelect()
    expect(edit).toHaveBeenCalledWith(
      m.web_canvas_menu_history_change_bubble_shape(),
      { kind: 'bubble', id: 'bb_3' },
      [{ op: 'replace', path: '/shape', value: 'shout' }],
    )
  })
}
