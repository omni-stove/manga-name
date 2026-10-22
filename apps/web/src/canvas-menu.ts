import {
  detachBubblePatch,
  fitBubblesPatch,
  joinBubblesPatch,
  joinCandidates,
  removeLastTailPatch,
  type Selection,
  type SplitAxis,
  splitPanelPatch,
  type Tool,
} from '@manga/editor-canvas'
import { m } from '@manga/i18n'
import { BUBBLE_SHAPES, FOCUS_KINDS } from '@manga/inspector'
import {
  type Bubble,
  hasTail,
  type Page,
  type Patch,
  type ProjectSettings,
  pageSizeOf,
} from '@manga/schema'
import type { ContextMenuItem, SegmentedOption } from '@manga/ui'
import { findBubble, findFocus, findPanel, findVector } from './inspector-ops'

type MenuItems = (ContextMenuItem | 'separator')[]
type Target = NonNullable<Selection>

export interface ElementMenuContext {
  page: Page
  settings: Pick<ProjectSettings, 'pageSize' | 'direction'>
  /** 出してよいツール。キーの表記もここから引く */
  tools: readonly SegmentedOption<Tool>[]
  /** 今のツール */
  tool: Tool
  /** `target` の要素 root の Patch を当てる */
  edit(label: string, target: Target, patch: Patch): void
  /** 当てる時点のページから page root の Patch を組んで当てる */
  editPage(label: string, build: (page: Page) => Patch): void
  remove(target: Target): void
  setTool(tool: Tool): void
  /** フキダシの形を選ぶメニューに切り替える */
  openShapes(): void
  /** フキダシをつなぐ相手を選ぶメニューに切り替える */
  openJoins(): void
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
      // 他のツールではコマを押すとフキダシや焦点を置くことになり、コマをドラッグで動かせるのは select ツールだけなので、そこへ切り替える
      ...(found.panel.locked || ctx.tool === 'select'
        ? []
        : toolItem('select', m.web_canvas_menu_panel_move())),
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
    const removeTail = removeLastTailPatch(found.bubble)
    const detach = (page: Page) => detachBubblePatch(page, target.id)
    return [
      {
        label: m.web_canvas_menu_bubble_shape({ shape: shape?.label ?? found.bubble.shape }),
        onSelect: ctx.openShapes,
      },
      {
        label: m.web_canvas_menu_bubble_join(),
        disabled: joinCandidates(ctx.page, target.id).length === 0,
        onSelect: ctx.openJoins,
      },
      {
        label: m.web_canvas_menu_bubble_detach(),
        disabled: detach(ctx.page).length === 0,
        onSelect: () => ctx.editPage(m.web_canvas_menu_history_detach_bubble(), detach),
      },
      // しっぽを描かない形では、残っているしっぽを消しても見た目が変わらないので出さない
      ...(hasTail(found.bubble.shape)
        ? [
            {
              label: m.web_canvas_menu_bubble_remove_tail(),
              disabled: removeTail.length === 0,
              onSelect: () => move(m.web_canvas_menu_bubble_remove_tail(), removeTail),
            },
          ]
        : []),
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

/** つなぐ相手の項目に出すセリフの字数。超えた分は … で切る */
const JOIN_TEXT_LENGTH = 12

/** フキダシ bubble をつなぐ相手を選ぶ項目。相手は同じコマの joinCandidates で、順番とセリフの頭で見分ける */
export function joinMenuItems(
  bubble: Pick<Bubble, 'id'>,
  ctx: Pick<ElementMenuContext, 'page' | 'editPage'>,
): ContextMenuItem[] {
  return joinCandidates(ctx.page, bubble.id).map((other) => {
    const text = [...other.text.replace(/\s+/g, ' ').trim()]
    const cut = text.length > JOIN_TEXT_LENGTH
    const head = cut ? `${text.slice(0, JOIN_TEXT_LENGTH).join('')}…` : text.join('')
    return {
      label:
        head === ''
          ? m.web_canvas_menu_bubble_join_to_blank({ order: other.order })
          : m.web_canvas_menu_bubble_join_to({ order: other.order, text: head }),
      onSelect: () =>
        ctx.editPage(m.web_canvas_menu_history_join_bubbles(), (page) =>
          joinBubblesPatch(page, bubble.id, other.id),
        ),
    }
  })
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
    tool: 'select',
    edit: vi.fn(),
    editPage: vi.fn(),
    remove: vi.fn(),
    setTool: vi.fn(),
    openShapes: vi.fn(),
    openJoins: vi.fn(),
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

    test('a panel offers the select tool to move it only from another tool', () => {
      const panel = page.panels[0]
      if (!panel) throw new Error('fixture にコマがない')
      const target = { kind: 'panel', id: panel.id } as const
      expect(() =>
        item(elementMenuItems(target, contextOf()), m.web_canvas_menu_panel_move()),
      ).toThrow()
      const ctx = contextOf({ tool: 'bubble' })
      const move = item(elementMenuItems(target, ctx), m.web_canvas_menu_panel_move())
      expect(move.shortcut).toBe('v')
      move.onSelect()
      expect(ctx.setTool).toHaveBeenCalledWith('select')
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

    test('a bubble removes its last touched tail, and offers nothing to remove without tails', () => {
      const ctx = contextOf()
      item(
        elementMenuItems({ kind: 'bubble', id: 'bb_3' }, ctx),
        m.web_canvas_menu_bubble_remove_tail(),
      ).onSelect()
      expect(ctx.edit).toHaveBeenCalledWith(
        m.web_canvas_menu_bubble_remove_tail(),
        { kind: 'bubble', id: 'bb_3' },
        [{ op: 'remove', path: '/tails' }],
      )

      const withBubble = (bubble: Partial<Bubble>) => ({
        ...page,
        panels: page.panels.map((p) => ({
          ...p,
          bubbles: p.bubbles.map((b) => (b.id === 'bb_3' ? { ...b, ...bubble } : b)),
        })),
      })
      const two = [
        { x: 0.1, y: 0.9 },
        { x: 0.9, y: 0.9 },
      ]
      const twoCtx = contextOf({ page: withBubble({ tails: two }) })
      item(
        elementMenuItems({ kind: 'bubble', id: 'bb_3' }, twoCtx),
        m.web_canvas_menu_bubble_remove_tail(),
      ).onSelect()
      expect(twoCtx.edit).toHaveBeenCalledWith(
        m.web_canvas_menu_bubble_remove_tail(),
        { kind: 'bubble', id: 'bb_3' },
        [{ op: 'remove', path: '/tails/1' }],
      )

      const bare = elementMenuItems(
        { kind: 'bubble', id: 'bb_3' },
        contextOf({ page: withBubble({ tails: undefined }) }),
      )
      expect(item(bare, m.web_canvas_menu_bubble_remove_tail()).disabled).toBe(true)
      const narration = elementMenuItems(
        { kind: 'bubble', id: 'bb_3' },
        contextOf({ page: withBubble({ shape: 'narration' }) }),
      )
      expect(() => item(narration, m.web_canvas_menu_bubble_remove_tail())).toThrow()
    })

    test('a bubble opens the menu to join another of its panel, and detaches a joined one', () => {
      // bb_3 は pn_3 のただ 1 つのフキダシ
      const lone = elementMenuItems({ kind: 'bubble', id: 'bb_3' }, contextOf())
      expect(item(lone, m.web_canvas_menu_bubble_join()).disabled).toBe(true)
      expect(item(lone, m.web_canvas_menu_bubble_detach()).disabled).toBe(true)

      const pair = (joinedTo?: string): Page => ({
        ...page,
        panels: page.panels.map((p) => {
          const first = p.bubbles[0]
          if (p.id !== 'pn_3' || !first) return p
          const next = { ...first, id: 'bb_3b', order: 2, text: '  続けて\n喋る  ', joinedTo }
          return { ...p, bubbles: [first, next] }
        }),
      })
      const ctx = contextOf({ page: pair() })
      const items = elementMenuItems({ kind: 'bubble', id: 'bb_3' }, ctx)
      expect(item(items, m.web_canvas_menu_bubble_detach()).disabled).toBe(true)
      item(items, m.web_canvas_menu_bubble_join()).onSelect()
      expect(ctx.openJoins).toHaveBeenCalled()

      const joins = joinMenuItems({ id: 'bb_3' }, ctx)
      expect(joins.map((j) => j.label)).toEqual([
        m.web_canvas_menu_bubble_join_to({ order: 2, text: '続けて 喋る' }),
      ])
      joins[0]?.onSelect()
      const [label, build] = vi.mocked(ctx.editPage).mock.calls[0] ?? []
      expect(label).toBe(m.web_canvas_menu_history_join_bubbles())
      expect(build?.(pair())).toEqual([
        { op: 'add', path: '/panels/2/bubbles/0/joinedTo', value: 'bb_3b' },
      ])

      const joinedCtx = contextOf({ page: pair('bb_3') })
      const joined = elementMenuItems({ kind: 'bubble', id: 'bb_3' }, joinedCtx)
      expect(item(joined, m.web_canvas_menu_bubble_join()).disabled).toBe(true)
      item(joined, m.web_canvas_menu_bubble_detach()).onSelect()
      const [detachLabel, detach] = vi.mocked(joinedCtx.editPage).mock.calls[0] ?? []
      expect(detachLabel).toBe(m.web_canvas_menu_history_detach_bubble())
      expect(detach?.(pair('bb_3'))).toEqual([
        { op: 'remove', path: '/panels/2/bubbles/1/joinedTo' },
      ])
    })

    test('joinMenuItems cuts a long line and names a blank one', () => {
      const withText = (text: string): Page => ({
        ...page,
        panels: page.panels.map((p) => {
          const first = p.bubbles[0]
          if (p.id !== 'pn_3' || !first) return p
          return { ...p, bubbles: [first, { ...first, id: 'bb_3b', order: 2, text }] }
        }),
      })
      const label = (text: string) =>
        joinMenuItems({ id: 'bb_3' }, contextOf({ page: withText(text) }))[0]?.label
      expect(label('あいうえおかきくけこさしすせそ')).toBe(
        m.web_canvas_menu_bubble_join_to({ order: 2, text: 'あいうえおかきくけこさし…' }),
      )
      expect(label('  ')).toBe(m.web_canvas_menu_bubble_join_to_blank({ order: 2 }))
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
