// @vitest-environment jsdom
import { fixtures, type Page, type PageDiagnosis, type Panel, type Patch } from '@manga/schema'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { BubbleInspector } from './bubble-inspector'
import { CharacterInspector } from './character-inspector'
import { FocusInspector } from './focus-inspector'
import { PageInspector } from './page-inspector'
import { PageScriptInspector } from './page-script-inspector'
import { PanelInspector } from './panel-inspector'
import { VectorInspector } from './vector-inspector'

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

const selectLabelled = (container: HTMLElement, label: string) => {
  const field = [...container.querySelectorAll('label')].find(
    (el) => el.firstElementChild?.textContent === label,
  )
  return must(must(field).querySelector('select'))
}

const choose = (select: HTMLSelectElement, value: string) =>
  act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

const buttonNamed = (container: HTMLElement, name: string) =>
  must(
    [...container.querySelectorAll('button')].find(
      (b) => (b.getAttribute('aria-label') ?? b.textContent) === name,
    ),
  )

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

  test('every art but the current one has a remove button that calls onRemoveArt', async () => {
    const onRemoveArt = vi.fn<(artId: string) => void>()
    const props = {
      panel: panelWithArts,
      characters: project.characters,
      onChange: () => {},
      onGenerate: () => {},
      resolveAsset,
    }
    const removeOf = (container: HTMLElement, id: string) =>
      [...container.querySelectorAll(`[data-art-id="${id}"] button`)].find(
        (b) => b.getAttribute('aria-label') === '削除',
      ) as HTMLButtonElement | undefined

    const { container, root } = await render(<PanelInspector {...props} />)
    expect(removeOf(container, 'art_1')).toBeUndefined()

    await act(async () => root.render(<PanelInspector {...props} onRemoveArt={onRemoveArt} />))
    expect(removeOf(container, 'art_2')).toBeUndefined()
    await act(async () => must(removeOf(container, 'art_3')).click())
    expect(onRemoveArt).toHaveBeenCalledWith('art_3')
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

  test('allowing overflow adds it, and disallowing it removes it', async () => {
    const onChange = vi.fn<(patch: Patch) => void>()
    const bubble = must(samplePanel.bubbles[0])
    const outside = { ...bubble, pos: { x: 1, y: 0 }, overflow: true }
    const props = { bubble, characters: project.characters, onChange }
    const { container, root } = await render(<BubbleInspector {...props} />)
    const checkbox = must(
      [...container.querySelectorAll('label')]
        .find((el) => el.textContent === '枠からはみ出す')
        ?.querySelector<HTMLInputElement>('input[type="checkbox"]'),
    )
    expect(checkbox.checked).toBe(false)
    await act(async () => checkbox.click())
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'add', path: '/overflow', value: true }])

    await act(async () => root.render(<BubbleInspector {...props} bubble={outside} />))
    expect(checkbox.checked).toBe(true)
    await act(async () => checkbox.click())
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/overflow' }])
  })
})

describe('CharacterInspector', () => {
  const character = must(project.characters[0])

  test('name and short name replace on input, and a blank one is invalid and emits nothing', async () => {
    const onChange = vi.fn<(patch: Patch) => void>()
    const { container } = await render(
      <CharacterInspector
        character={character}
        onChange={onChange}
        onPickReference={() => {}}
        onGenerateReference={() => {}}
        resolveAsset={resolveAsset}
      />,
    )
    const name = inputLabelled(container, '名前')
    await act(async () => setValue(name, ' '))
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => setValue(name, 'エル'))
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/name', value: 'エル' }])

    await act(async () => setValue(inputLabelled(container, '略称'), 'L'))
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/shortName', value: 'L' }])
  })

  test('appearance and note are debounced, and clearing appearance removes it', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn<(patch: Patch) => void>()
    const { container } = await render(
      <CharacterInspector
        character={character}
        onChange={onChange}
        onPickReference={() => {}}
        onGenerateReference={() => {}}
        resolveAsset={resolveAsset}
      />,
    )
    await act(async () => setValue(inputLabelled(container, '外見'), ''))
    await act(async () => vi.advanceTimersByTime(299))
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(onChange).toHaveBeenCalledWith([{ op: 'remove', path: '/appearance' }])

    await act(async () => setValue(inputLabelled(container, 'メモ'), '口数が少ない'))
    await act(async () => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'add', path: '/note', value: '口数が少ない' }])
  })

  test('without a reference image shows the default image, and the buttons pick or generate one', async () => {
    const onPickReference = vi.fn()
    const onGenerateReference = vi.fn()
    const { container } = await render(
      <CharacterInspector
        character={character}
        onChange={() => {}}
        onPickReference={onPickReference}
        onGenerateReference={onGenerateReference}
        resolveAsset={resolveAsset}
      />,
    )
    const group = must(container.querySelector('[role="group"][aria-label="参照画像"]'))
    expect(group.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('既定の画像')
    expect(group.querySelector('img')).toBeNull()
    await act(async () => buttonNamed(container, '画像を選ぶ').click())
    expect(onPickReference).toHaveBeenCalledTimes(1)
    await act(async () => buttonNamed(container, '外見から生成').click())
    expect(onGenerateReference).toHaveBeenCalledTimes(1)
  })

  test('generating needs an appearance, and while generating the buttons are disabled', async () => {
    const button = (container: HTMLElement, name: string) =>
      buttonNamed(container, name) as HTMLButtonElement
    const bare = await render(
      <CharacterInspector
        character={{ ...character, appearance: undefined }}
        onChange={() => {}}
        onPickReference={() => {}}
        onGenerateReference={() => {}}
        resolveAsset={resolveAsset}
      />,
    )
    expect(button(bare.container, '外見から生成').disabled).toBe(true)
    expect(button(bare.container, '画像を選ぶ').disabled).toBe(false)

    const busy = await render(
      <CharacterInspector
        character={character}
        generating
        onChange={() => {}}
        onPickReference={() => {}}
        onGenerateReference={() => {}}
        resolveAsset={resolveAsset}
      />,
    )
    expect(button(busy.container, '生成中…').disabled).toBe(true)
    expect(button(busy.container, '画像を選ぶ').disabled).toBe(true)
  })

  test('a reference image is shown resolved, and 外す removes referenceRef', async () => {
    const onChange = vi.fn<(patch: Patch) => void>()
    const resolve = vi.fn(resolveAsset)
    const { container } = await render(
      <CharacterInspector
        character={{ ...character, referenceRef: 'blob:ref_e' }}
        onChange={onChange}
        onPickReference={() => {}}
        onGenerateReference={() => {}}
        resolveAsset={resolve}
      />,
    )
    await act(async () => {})
    expect(resolve).toHaveBeenCalledWith('blob:ref_e')
    const img = must(container.querySelector('img'))
    expect(img.getAttribute('src')).toBe('url:blob:ref_e')
    expect(img.getAttribute('alt')).toBe(`${character.name} の参照画像`)
    expect(buttonNamed(container, '差し替え')).toBeTruthy()
    await act(async () => buttonNamed(container, '外す').click())
    expect(onChange).toHaveBeenCalledWith([{ op: 'remove', path: '/referenceRef' }])
  })

  test('a reference that fails to resolve says it cannot be loaded', async () => {
    const { container } = await render(
      <CharacterInspector
        character={{ ...character, referenceRef: 'blob:gone' }}
        onChange={() => {}}
        onPickReference={() => {}}
        onGenerateReference={() => {}}
        resolveAsset={() => Promise.reject(new Error('gone'))}
      />,
    )
    await act(async () => {})
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('読み込めません')
  })
})

describe('FocusInspector', () => {
  const focus = must(samplePanel.focusPoints.find((f) => f.characterId))

  test('kind, label, weight and character each emit their own patch', async () => {
    const onChange = vi.fn<(patch: Patch) => void>()
    const { container } = await render(
      <FocusInspector focus={focus} characters={project.characters} onChange={onChange} />,
    )
    await choose(selectLabelled(container, '種別'), 'sfx')
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/kind', value: 'sfx' }])

    await act(async () => setValue(inputLabelled(container, 'ラベル'), 'E'))
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/label', value: 'E' }])

    const weight = must(container.querySelector<HTMLInputElement>('input[type="range"]'))
    const hintId = must(weight.getAttribute('aria-describedby'))
    expect(must(document.getElementById(hintId)).textContent).toBe(focus.weight.toFixed(2))
    await act(async () => setValue(weight, '0.75'))
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/weight', value: 0.75 }])

    const character = selectLabelled(container, 'キャラクター')
    expect(character.value).toBe(focus.characterId)
    await choose(character, '')
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/characterId' }])
  })

  test('assigns a character to a focus without one', async () => {
    const onChange = vi.fn<(patch: Patch) => void>()
    const { characterId: _, ...plain } = focus
    const { container } = await render(
      <FocusInspector focus={plain} characters={project.characters} onChange={onChange} />,
    )
    const select = selectLabelled(container, 'キャラクター')
    expect(select.value).toBe('')
    await choose(select, 'chr_e')
    expect(onChange).toHaveBeenCalledWith([{ op: 'add', path: '/characterId', value: 'chr_e' }])
  })

  test('shows the focus diagnosis with its status and reason only when given', async () => {
    const props = { focus, characters: project.characters, onChange: () => {} }
    const { container, root } = await render(<FocusInspector {...props} />)
    expect(container.querySelector('dl')).toBeNull()

    const diagnosis = {
      focusPointId: focus.id,
      kind: focus.kind,
      panelId: samplePanel.id,
      t: 0.4567,
      distance: 0.1,
      strong: 1,
      weak: 2,
      status: 'weak' as const,
      reason: '誘導線が弱い',
    }
    await act(async () => root.render(<FocusInspector {...props} diagnosis={diagnosis} />))
    const dl = must(container.querySelector('dl'))
    expect(dl.getAttribute('data-diagnosis-status')).toBe('weak')
    expect(dl.textContent).toContain('0.46')
    expect(dl.textContent).toContain('強 1 / 弱 2')
    expect(dl.textContent).toContain('誘導線が弱い')

    const { reason: _, ...withoutReason } = diagnosis
    await act(async () => root.render(<FocusInspector {...props} diagnosis={withoutReason} />))
    expect(must(container.querySelector('dl')).textContent).not.toContain('理由')
  })
})

describe('VectorInspector', () => {
  const vector = must(samplePanel.vectors.find((v) => v.targetFocusId))
  const targets = samplePanel.focusPoints.map((f) => ({ value: f.id, label: f.label }))

  test('kind and strength replace, and the target can be cleared to the nearest focus', async () => {
    const onChange = vi.fn<(patch: Patch) => void>()
    const { container } = await render(
      <VectorInspector vector={vector} targets={targets} onChange={onChange} />,
    )
    await choose(selectLabelled(container, '種別'), 'speed')
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/kind', value: 'speed' }])
    await choose(selectLabelled(container, '強さ'), 'weak')
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/strength', value: 'weak' }])

    const target = selectLabelled(container, '指す焦点')
    expect([...target.options].map((o) => o.value)).toEqual(['', ...targets.map((t) => t.value)])
    await choose(target, '')
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/targetFocusId' }])
  })

  test('a target that is no longer in targets stays selectable', async () => {
    const { container } = await render(
      <VectorInspector
        vector={{ ...vector, targetFocusId: 'fp_gone' }}
        targets={targets}
        onChange={() => {}}
      />,
    )
    const target = selectLabelled(container, '指す焦点')
    expect(target.value).toBe('fp_gone')
    expect([...target.options].at(-1)?.textContent).toBe('fp_gone')
  })
})

describe('PageScriptInspector', () => {
  const page = project.episodes[0]?.pages[0] as Page

  test('the script is debounced and an emptied script removes the field', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn<(patch: Patch) => void>()
    const { container } = await render(<PageScriptInspector page={page} onChange={onChange} />)
    await act(async () => setValue(inputLabelled(container, 'このページの脚本'), 'E「……ここか」'))
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenLastCalledWith([
      { op: 'add', path: '/script', value: 'E「……ここか」' },
    ])

    const scripted = await render(
      <PageScriptInspector page={{ ...page, script: 's' }} onChange={onChange} />,
    )
    await act(async () => setValue(inputLabelled(scripted.container, 'このページの脚本'), ''))
    await act(async () => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/script' }])
  })

  test('is read-only when not editable', async () => {
    const { container } = await render(
      <PageScriptInspector page={page} editable={false} onChange={() => {}} />,
    )
    expect(inputLabelled(container, 'このページの脚本').matches(':disabled')).toBe(true)
  })
})

describe('PageInspector', () => {
  const page = project.episodes[0]?.pages[0] as Page
  const withReference: Page = {
    ...page,
    reference: { ref: 'blob:ref_page', opacity: 0.5, visible: true },
  }

  test('side replaces and note is debounced', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn<(patch: Patch) => void>()
    const { container } = await render(
      <PageInspector
        page={page}
        onChange={onChange}
        onGenerateAll={() => {}}
        onPickReference={() => {}}
      />,
    )
    await choose(selectLabelled(container, '見開き'), 'left')
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/side', value: 'left' }])

    await act(async () => setValue(inputLabelled(container, 'メモ'), '見開きの導入'))
    expect(onChange).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'add', path: '/note', value: '見開きの導入' }])
  })

  test('without a reference only offers to load one', async () => {
    const onPickReference = vi.fn()
    const { container } = await render(
      <PageInspector
        page={page}
        onChange={() => {}}
        onGenerateAll={() => {}}
        onPickReference={onPickReference}
      />,
    )
    expect(container.querySelector('input[type="range"]')).toBeNull()
    expect(container.querySelector('input[type="checkbox"]')).toBeNull()
    expect(
      [...container.querySelectorAll('button')].some(
        (b) => b.getAttribute('aria-label') === '削除',
      ),
    ).toBe(false)
    await act(async () => buttonNamed(container, '読み込む').click())
    expect(onPickReference).toHaveBeenCalledTimes(1)
  })

  test('a reference has opacity, visibility, replace and delete controls', async () => {
    const onChange = vi.fn<(patch: Patch) => void>()
    const onPickReference = vi.fn()
    const { container } = await render(
      <PageInspector
        page={withReference}
        onChange={onChange}
        onGenerateAll={() => {}}
        onPickReference={onPickReference}
      />,
    )
    const opacity = must(container.querySelector<HTMLInputElement>('input[type="range"]'))
    const hintId = must(opacity.getAttribute('aria-describedby'))
    expect(must(document.getElementById(hintId)).textContent).toBe('50%')
    await act(async () => setValue(opacity, '0.25'))
    expect(onChange).toHaveBeenLastCalledWith([
      { op: 'replace', path: '/reference/opacity', value: 0.25 },
    ])

    const visible = must(container.querySelector<HTMLInputElement>('input[type="checkbox"]'))
    expect(visible.checked).toBe(true)
    await act(async () => visible.click())
    expect(onChange).toHaveBeenLastCalledWith([
      { op: 'replace', path: '/reference/visible', value: false },
    ])

    await act(async () => buttonNamed(container, '差し替え').click())
    expect(onPickReference).toHaveBeenCalledTimes(1)
    await act(async () => buttonNamed(container, '削除').click())
    expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/reference' }])
  })

  test('generate all is disabled while generating and for a page without panels', async () => {
    const onGenerateAll = vi.fn()
    const props = {
      page,
      onChange: () => {},
      onGenerateAll,
      onPickReference: () => {},
    }
    const { container, root } = await render(<PageInspector {...props} />)
    expect(container.textContent).toContain(`コマ ${page.panels.length}`)
    await act(async () => buttonNamed(container, 'このページを全部生成').click())
    expect(onGenerateAll).toHaveBeenCalledTimes(1)

    await act(async () => root.render(<PageInspector {...props} generating />))
    expect(buttonNamed(container, '生成中…').disabled).toBe(true)

    await act(async () => root.render(<PageInspector {...props} page={{ ...page, panels: [] }} />))
    expect(buttonNamed(container, 'このページを全部生成').disabled).toBe(true)

    await act(async () => root.render(<PageInspector {...props} onGenerateAll={undefined} />))
    expect(buttonNamed(container, 'このページを全部生成').disabled).toBe(true)
  })

  test('editable = false disables everything but generate all', async () => {
    const { container } = await render(
      <PageInspector
        page={withReference}
        editable={false}
        onChange={() => {}}
        onGenerateAll={() => {}}
        onPickReference={() => {}}
      />,
    )
    const enabled = [
      ...container.querySelectorAll<HTMLButtonElement>('button, input, select, textarea'),
    ]
      .filter((el) => !el.matches(':disabled'))
      .map((el) => el.textContent)
    expect(enabled).toEqual(['このページを全部生成'])
  })

  test('shows the page diagnosis summary and issues', async () => {
    const diagnosis: PageDiagnosis = {
      pageId: page.id,
      readingOrderOk: false,
      inferredOrder: [],
      panels: [],
      bubbleChain: [],
      summary: { total: 5, ok: 3, weak: 1, miss: 1 },
      issues: [
        { severity: 'error', code: 'READING_ORDER', message: '読み順が逆' },
        { severity: 'warning', code: 'FOCUS_WEAK', panelId: 'pn_2', message: '焦点が弱い' },
      ],
    }
    const { container } = await render(
      <PageInspector
        page={page}
        diagnosis={diagnosis}
        onChange={() => {}}
        onGenerateAll={() => {}}
        onPickReference={() => {}}
      />,
    )
    const dl = must(container.querySelector('dl'))
    expect(must(dl.querySelector('[data-ok]')).textContent).toBe('配置と食い違い')
    expect(dl.textContent).toContain('5 件: ok 3 / weak 1 / miss 1')
    const issues = [...dl.querySelectorAll('li')]
    expect(issues.map((li) => li.getAttribute('data-severity'))).toEqual(['error', 'warning'])
    expect(issues.map((li) => li.textContent)).toEqual([
      '[error] 読み順が逆',
      '[warning] 焦点が弱い',
    ])
  })
})
