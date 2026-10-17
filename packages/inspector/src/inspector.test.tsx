// @vitest-environment jsdom
import { fixtures, type Panel, type Patch } from '@manga/schema'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { BubbleInspector } from './bubble-inspector'
import { PanelInspector } from './panel-inspector'
import { ProjectSettingsInspector } from './project-settings-inspector'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const project = fixtures.samplePage01
const samplePanel = project.episodes[0]?.pages[0]?.panels[0] as Panel
const resolveAsset = (ref: string) => Promise.resolve(`url:${ref}`)

const art = (id: string, instruction?: string) => ({
  id,
  ref: `blob:${id}`,
  provider: 'fake',
  prompt: `prompt ${id}`,
  instruction,
  createdAt: '2026-10-16T00:00:00.000Z',
})

const panelWithArts: Panel = {
  ...samplePanel,
  arts: [art('art_1'), art('art_2', '顔を大きく'), art('art_3')],
  artId: 'art_2',
}

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  vi.useRealTimers()
})

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing')
  return value
}

async function render(element: ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  return { container, root }
}

const setValue = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  must(Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set).call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const inputLabelled = (container: HTMLElement, label: string) => {
  const field = [...container.querySelectorAll('label')].find(
    (el) => el.firstElementChild?.textContent === label,
  )
  return must(must(field).querySelector('input, textarea')) as
    | HTMLInputElement
    | HTMLTextAreaElement
}

describe('PanelInspector', () => {
  test('lists the cast with why each character is in it and adds or removes only cast entries', async () => {
    const onChange = vi.fn<(patch: Patch) => void>()
    const focused = must(samplePanel.focusPoints.find((f) => f.characterId)?.characterId)
    const extra = { id: 'chr_extra', name: '通行人', shortName: '通' }
    const { container } = await render(
      <PanelInspector
        panel={samplePanel}
        characters={[...project.characters, extra]}
        onChange={onChange}
        onGenerate={() => {}}
        resolveAsset={resolveAsset}
      />,
    )
    const item = must(container.querySelector(`[data-cast-id="${focused}"]`))
    expect(item.textContent).toContain('焦点')
    expect(item.querySelector('button')).toBeNull()

    const select = must(
      container.querySelector<HTMLSelectElement>('select[aria-label="登場キャラを追加"]'),
    )
    await act(async () => {
      select.value = extra.id
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith([{ op: 'add', path: '/cast', value: [extra.id] }])
  })

  test('a character added to the cast can be removed', async () => {
    const onChange = vi.fn<(patch: Patch) => void>()
    const extra = { id: 'chr_extra', name: '通行人', shortName: '通' }
    const { container } = await render(
      <PanelInspector
        panel={{ ...samplePanel, cast: [extra.id] }}
        characters={[...project.characters, extra]}
        onChange={onChange}
        onGenerate={() => {}}
        resolveAsset={resolveAsset}
      />,
    )
    await act(async () =>
      must(container.querySelector<HTMLElement>(`[data-cast-id="${extra.id}"] button`)).click(),
    )
    expect(onChange).toHaveBeenCalledWith([{ op: 'remove', path: '/cast' }])
  })

  test('switching among three arts emits replace /artId and highlights the current one', async () => {
    const onChange = vi.fn<(patch: Patch) => void>()
    const { container } = await render(
      <PanelInspector
        panel={panelWithArts}
        characters={project.characters}
        onChange={onChange}
        onGenerate={() => {}}
        resolveAsset={resolveAsset}
      />,
    )
    const items = container.querySelectorAll('[data-art-id]')
    expect(items).toHaveLength(3)
    expect(must(container.querySelector('[data-current]')).getAttribute('data-art-id')).toBe(
      'art_2',
    )
    expect(container.querySelector('[data-art-id="art_2"] p')?.textContent).toBe('顔を大きく')

    await act(async () =>
      must(container.querySelector<HTMLElement>('[data-art-id="art_3"] button')).click(),
    )
    expect(onChange).toHaveBeenCalledWith([{ op: 'replace', path: '/artId', value: 'art_3' }])

    await act(async () =>
      must(container.querySelector<HTMLElement>('[data-art-id="art_2"] button')).click(),
    )
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  test('note is debounced 300ms, order commits on Enter, an invalid order emits nothing', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn<(patch: Patch) => void>()
    const { container } = await render(
      <PanelInspector
        panel={samplePanel}
        characters={project.characters}
        onChange={onChange}
        onGenerate={() => {}}
        resolveAsset={resolveAsset}
      />,
    )
    await act(async () => setValue(inputLabelled(container, '指示メモ'), 'メモ'))
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(299))
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(onChange).toHaveBeenCalledWith([{ op: 'add', path: '/note', value: 'メモ' }])

    const order = inputLabelled(container, '読み順')
    await act(async () => setValue(order, '0'))
    expect(order.getAttribute('aria-invalid')).toBe('true')
    expect(onChange).toHaveBeenCalledTimes(1)
    await act(async () => setValue(order, '3'))
    expect(onChange).toHaveBeenCalledTimes(1)
    await act(async () => {
      order.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/order', value: 3 }])
  })

  test('the generate buttons call onGenerate with and without an instruction', async () => {
    const onGenerate = vi.fn<(instruction?: string) => void>()
    const { container } = await render(
      <PanelInspector
        panel={panelWithArts}
        characters={project.characters}
        onChange={() => {}}
        onGenerate={onGenerate}
        resolveAsset={resolveAsset}
      />,
    )
    const buttons = [...container.querySelectorAll('button')]
    const generate = must(buttons.find((b) => b.textContent === '生成'))
    const regenerate = must(buttons.find((b) => b.textContent === '修正して再生成'))
    expect(regenerate.disabled).toBe(true)
    await act(async () => generate.click())
    expect(onGenerate).toHaveBeenCalledWith()

    await act(async () => setValue(inputLabelled(container, '修正指示'), ' もっと暗く '))
    expect(regenerate.disabled).toBe(false)
    await act(async () => regenerate.click())
    expect(onGenerate).toHaveBeenLastCalledWith('もっと暗く')
  })

  test('shows the hint read-only and the use-hint checkbox reports its state', async () => {
    const onUseHintChange = vi.fn<(use: boolean) => void>()
    const onChange = vi.fn<(patch: Patch) => void>()
    const hint = '視線は中央の glass-crystal forest を大きく捉える'
    const props = {
      panel: samplePanel,
      characters: project.characters,
      diagnosis: {
        panelId: samplePanel.id,
        sweepPath: [],
        focus: [],
        bubbleOrderOk: true,
        hint,
      },
      onChange,
      onGenerate: () => {},
      onUseHintChange,
      resolveAsset,
    }
    const { container, root } = await render(<PanelInspector {...props} />)
    const shown = must(container.querySelector('[data-hint]'))
    expect(shown.textContent).toBe(hint)
    expect(shown.querySelector('input, textarea')).toBeNull()
    const checkbox = must(
      [...container.querySelectorAll('label')]
        .find((el) => el.textContent === 'ヒントを使う')
        ?.querySelector<HTMLInputElement>('input[type="checkbox"]'),
    )
    expect(checkbox.checked).toBe(true)

    await act(async () => checkbox.click())
    expect(onUseHintChange).toHaveBeenLastCalledWith(false)
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => root.render(<PanelInspector {...props} useHint={false} />))
    expect(checkbox.checked).toBe(false)
    expect(shown.getAttribute('data-used')).toBe('false')
    await act(async () => checkbox.click())
    expect(onUseHintChange).toHaveBeenLastCalledWith(true)
  })

  test('renders without diagnosis and with an empty panel', async () => {
    const { container } = await render(
      <PanelInspector
        panel={{ ...samplePanel, bubbles: [], arts: [], artId: undefined }}
        characters={[]}
        onChange={() => {}}
        onGenerate={() => {}}
        resolveAsset={resolveAsset}
      />,
    )
    expect(container.textContent).toContain('フキダシはありません')
    expect(container.textContent).toContain('まだ生成していません')
  })
})

describe('BubbleInspector', () => {
  test('clearing the speaker removes it and text is debounced', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn<(patch: Patch) => void>()
    const bubble = must(samplePanel.bubbles[0])
    const { container } = await render(
      <BubbleInspector
        bubble={{ ...bubble, speakerId: 'chr_e' }}
        characters={project.characters}
        onChange={onChange}
      />,
    )
    const select = must(container.querySelector('select'))
    await act(async () => {
      select.value = ''
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith([{ op: 'remove', path: '/speakerId' }])

    await act(async () => setValue(inputLabelled(container, 'セリフ'), '新しいセリフ'))
    await act(async () => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenLastCalledWith([
      { op: 'replace', path: '/text', value: '新しいセリフ' },
    ])
  })
})

describe('ProjectSettingsInspector', () => {
  test('a dpi outside the schema emits nothing and a valid one replaces /dpi', async () => {
    const onChange = vi.fn<(patch: Patch) => void>()
    const { container } = await render(
      <ProjectSettingsInspector settings={project.settings} onChange={onChange} />,
    )
    const dpi = inputLabelled(container, 'dpi')
    await act(async () => setValue(dpi, '-1'))
    await act(async () => setValue(dpi, '72.5'))
    await act(async () => setValue(dpi, ''))
    expect(onChange).not.toHaveBeenCalled()
    expect(dpi.getAttribute('aria-invalid')).toBe('true')
    await act(async () => setValue(dpi, '600'))
    expect(onChange).toHaveBeenCalledWith([{ op: 'replace', path: '/dpi', value: 600 }])
  })
})
