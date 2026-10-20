// @vitest-environment jsdom
import { getLocale, m } from '@manga/i18n'
import {
  type Bubble,
  type Camera,
  CameraSchema,
  type Character,
  currentArt,
  type ID,
  type Panel,
  type PanelArt,
  PanelFrameSchema,
  PanelSchema,
  type Patch,
  panelCharacterIds,
  stripRuby,
} from '@manga/schema'
import {
  Button,
  Checkbox,
  IconButton,
  RemoveButton,
  Select,
  TextArea,
  Typography,
  XStack,
  YStack,
} from '@manga/ui'
import { Suspense, use, useState } from 'react'
import { assetUrl } from './asset-url'
import { DEBOUNCE_MS, NumberField, option, SelectField, TextField } from './fields'
import styles from './panel-inspector.module.css'
import {
  actingPatch,
  addCastPatch,
  optionalString,
  removeCastPatch,
  replace,
  swapOrder,
} from './patch'
import section from './section.module.css'
import type { PanelInspectorProps } from './types'

const CAMERAS: readonly { value: Camera | ''; label: string }[] = [
  option('', m.none),
  ...CameraSchema.options.map((camera) => option(camera, m[`panel_camera_${camera}` as const])),
]

const FRAMES: readonly { value: NonNullable<Panel['frame']> | ''; label: string }[] = [
  option('', m.panel_frame_solid),
  ...PanelFrameSchema.options.map((frame) => option(frame, m[`panel_frame_${frame}` as const])),
]

const isOrder = (n: number) => PanelSchema.shape.order.safeParse(n).success

/** `arts` の中から選ぶ。`artId` が無ければ add、あれば replace */
function selectArtPatch(artId: ID | undefined, next: ID): Patch {
  if (artId === next) return []
  return [{ op: artId === undefined ? 'add' : 'replace', path: '/artId', value: next }]
}

const byOrder = (bubbles: readonly Bubble[]) =>
  bubbles
    .map((bubble, index) => ({ bubble, index }))
    .sort((a, b) => a.bubble.order - b.bubble.order)

const formatDate = (iso: string) => new Date(iso).toLocaleString(getLocale())

export function PanelInspector({
  panel,
  characters,
  diagnosis,
  generating = false,
  onChange,
  onGenerate,
  useReference,
  onUseReferenceChange,
  useHint = true,
  onUseHintChange,
  onRemoveArt,
  resolveAsset,
}: PanelInspectorProps) {
  const [instruction, setInstruction] = useState('')
  const current = currentArt(panel)
  const bubbles = byOrder(panel.bubbles)
  const speakerOf = (bubble: Bubble) =>
    characters.find((c) => c.id === bubble.speakerId)?.shortName ?? ''
  const arts = [...panel.arts].reverse()

  return (
    <div className={section.section} data-inspector="panel">
      <Typography variant="subheading" className={section.title}>
        {m.inspector_panel_title({ order: panel.order })}
      </Typography>
      <NumberField
        label={m.inspector_reading_order()}
        value={panel.order}
        min={1}
        step={1}
        isValid={isOrder}
        commitOnBlur
        onCommit={(n) => onChange(replace('/order', n))}
      />
      <SelectField
        label={m.panel_camera()}
        value={panel.camera ?? ''}
        options={CAMERAS}
        onCommit={(v) => onChange(optionalString('/camera', panel.camera, v))}
      />
      <TextField
        label={m.panel_note()}
        value={panel.note ?? ''}
        rows={4}
        delayMs={DEBOUNCE_MS}
        onCommit={(v) => onChange(optionalString('/note', panel.note, v))}
      />
      <Checkbox
        label={m.panel_fill_black()}
        checked={panel.fill === 'black'}
        onChange={(e) =>
          onChange(
            e.target.checked
              ? [{ op: 'add', path: '/fill', value: 'black' }]
              : [{ op: 'remove', path: '/fill' }],
          )
        }
      />
      <SelectField
        label={m.panel_frame()}
        value={panel.frame ?? ''}
        options={FRAMES}
        onCommit={(v) => onChange(optionalString('/frame', panel.frame, v))}
      />
      <CastSection panel={panel} characters={characters} onChange={onChange} />
      {diagnosis && !diagnosis.bubbleOrderOk && (
        <p className={styles.hint} data-bubble-order-ok={false}>
          <small className={styles.hintWarning}>{m.inspector_panel_bubble_order_mismatch()}</small>
        </p>
      )}

      <Typography variant="label" tone="muted" className={section.heading}>
        {m.bubble()}
      </Typography>
      {bubbles.length === 0 ? (
        <Typography tone="muted">{m.inspector_panel_bubbles_empty()}</Typography>
      ) : (
        <YStack as="ol" gap={2} className={styles.bubbles}>
          {bubbles.map(({ bubble, index }, i) => {
            const prev = bubbles[i - 1]
            const next = bubbles[i + 1]
            return (
              <XStack as="li" key={bubble.id} className={styles.bubble} data-bubble-id={bubble.id}>
                <span className={styles.order}>{bubble.order}</span>
                <span className={styles.line}>
                  {speakerOf(bubble) && <b className={styles.speaker}>{speakerOf(bubble)}</b>}
                  {stripRuby(bubble.text).split('\n')[0] || m.empty()}
                </span>
                <IconButton
                  size="small"
                  label={m.inspector_panel_bubble_earlier()}
                  disabled={!prev}
                  onClick={() =>
                    prev &&
                    onChange(
                      swapOrder(
                        '/bubbles',
                        { index, order: bubble.order },
                        { index: prev.index, order: prev.bubble.order },
                      ),
                    )
                  }
                >
                  ▲
                </IconButton>
                <IconButton
                  size="small"
                  label={m.inspector_panel_bubble_later()}
                  disabled={!next}
                  onClick={() =>
                    next &&
                    onChange(
                      swapOrder(
                        '/bubbles',
                        { index, order: bubble.order },
                        { index: next.index, order: next.bubble.order },
                      ),
                    )
                  }
                >
                  ▼
                </IconButton>
              </XStack>
            )
          })}
        </YStack>
      )}

      <Typography variant="label" tone="muted" className={section.heading}>
        {m.generate()}
      </Typography>
      {diagnosis && (
        <>
          <p className={styles.hint} data-hint data-used={useHint}>
            {diagnosis.hint || (
              <Typography as="span" tone="muted">
                {m.inspector_panel_hint_empty()}
              </Typography>
            )}
          </p>
          <Checkbox
            label={m.inspector_panel_use_hint()}
            checked={useHint}
            onChange={(e) => onUseHintChange?.(e.target.checked)}
          />
        </>
      )}
      {useReference !== undefined && (
        <Checkbox
          label={m.inspector_panel_use_reference()}
          checked={useReference}
          onChange={(e) => onUseReferenceChange?.(e.target.checked)}
        />
      )}
      <XStack wrap className={section.group}>
        <Button variant="primary" disabled={generating} onClick={() => onGenerate()}>
          {generating ? m.generating() : m.generate()}
        </Button>
      </XStack>
      <TextArea
        label={m.inspector_panel_instruction()}
        rows={3}
        value={instruction}
        placeholder={m.inspector_panel_instruction_placeholder()}
        onChange={(e) => setInstruction(e.target.value)}
      />
      <XStack wrap className={section.group}>
        <Button
          disabled={generating || !current || instruction.trim() === ''}
          onClick={() => onGenerate(instruction.trim())}
        >
          {m.inspector_panel_regenerate()}
        </Button>
      </XStack>

      <Typography variant="label" tone="muted" className={section.heading}>
        {m.history()}
      </Typography>
      {arts.length === 0 ? (
        <Typography tone="muted">{m.inspector_panel_history_empty()}</Typography>
      ) : (
        <YStack as="ol" className={styles.arts}>
          {arts.map((art) => (
            <ArtItem
              key={art.id}
              art={art}
              url={assetUrl(resolveAsset, art.ref)}
              current={art.id === panel.artId}
              onSelect={() => {
                const patch = selectArtPatch(panel.artId, art.id)
                if (patch.length > 0) onChange(patch)
              }}
              onRemove={
                onRemoveArt && art.id !== panel.artId ? () => onRemoveArt(art.id) : undefined
              }
            />
          ))}
        </YStack>
      )}
    </div>
  )
}

/**
 * 登場キャラの一覧と追加。台詞か焦点から拾えるキャラは理由を添えて並べ、`cast` に入れたキャラだけ外せる。
 * 芝居の欄は台詞や焦点で拾えるキャラにも出す。追加の候補に出ないので、`cast` に入れたキャラだけでは話者に芝居を書けない
 */
function CastSection({
  panel,
  characters,
  onChange,
}: {
  panel: Panel
  characters: readonly Character[]
  onChange(patch: Patch): void
}) {
  const ids = panelCharacterIds(panel)
  const cast = ids.flatMap((id) => characters.filter((c) => c.id === id))
  const candidates = characters.filter((c) => !ids.includes(c.id))
  const reasons = (id: ID) =>
    [
      panel.bubbles.some((b) => b.speakerId === id) && m.inspector_panel_cast_reason_dialogue(),
      panel.focusPoints.some((f) => f.characterId === id) && m.focus_point(),
    ].filter((r) => r !== false)
  // 外して登場キャラに居なくなるなら芝居も消す。残すと画面に出ないまま参照が残る
  const removeCast = (id: ID): Patch => {
    const rest = panelCharacterIds({ ...panel, cast: panel.cast?.filter((c) => c !== id) })
    return [
      ...removeCastPatch(panel.cast, id),
      ...(rest.includes(id) ? [] : actingPatch(panel.acting, id, '')),
    ]
  }
  const actingOf = (id: ID) => panel.acting?.find((a) => a.characterId === id)?.text ?? ''
  return (
    <>
      <Typography variant="label" tone="muted" className={section.heading}>
        {m.panel_cast()}
      </Typography>
      {cast.length === 0 ? (
        <Typography tone="muted">{m.inspector_panel_cast_empty()}</Typography>
      ) : (
        <YStack as="ul" gap={2} className={styles.bubbles}>
          {cast.map((character) => (
            <YStack
              as="li"
              key={character.id}
              gap={4}
              className={styles.bubble}
              data-cast-id={character.id}
            >
              <XStack>
                <span className={styles.line}>
                  <b className={styles.speaker}>{character.name}</b>
                  <Typography as="small" variant="caption" tone="muted">
                    {reasons(character.id).join('・')}
                  </Typography>
                </span>
                {panel.cast?.includes(character.id) && (
                  <IconButton
                    size="small"
                    label={m.inspector_panel_cast_remove({ name: character.name })}
                    onClick={() => onChange(removeCast(character.id))}
                  >
                    ×
                  </IconButton>
                )}
              </XStack>
              <TextField
                label={m.inspector_panel_acting_label({ name: character.name })}
                value={actingOf(character.id)}
                placeholder={m.inspector_panel_acting_placeholder()}
                delayMs={DEBOUNCE_MS}
                onCommit={(v) => onChange(actingPatch(panel.acting, character.id, v))}
              />
            </YStack>
          ))}
        </YStack>
      )}
      {candidates.length > 0 && (
        <Select
          label={m.inspector_panel_cast_add()}
          hideLabel
          className={section.group}
          value=""
          onChange={(e) => {
            if (e.target.value) onChange(addCastPatch(panel.cast, e.target.value))
          }}
        >
          <option value="">{m.inspector_panel_cast_add_placeholder()}</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
    </>
  )
}

function ArtItem({
  art,
  url,
  current,
  onSelect,
  onRemove,
}: {
  art: PanelArt
  url: Promise<string | null>
  current: boolean
  onSelect(): void
  onRemove?(): void
}) {
  return (
    <XStack
      as="li"
      gap={12}
      align="stretch"
      className={styles.art}
      data-art-id={art.id}
      data-current={current || undefined}
    >
      <button type="button" className={styles.thumb} aria-pressed={current} onClick={onSelect}>
        <Suspense fallback={<span>{m.loading()}</span>}>
          <ArtImage url={url} alt={art.instruction ?? m.inspector_panel_art_alt()} />
        </Suspense>
      </button>
      <YStack gap={4} className={styles.meta}>
        <XStack as="span" className={styles.metaHead}>
          <time dateTime={art.createdAt}>{formatDate(art.createdAt)}</time>
          {current && <b className={styles.badge}>{m.inspector_panel_art_current()}</b>}
          {onRemove && (
            <RemoveButton
              size="small"
              label={m.remove()}
              className={styles.remove}
              onClick={onRemove}
            />
          )}
        </XStack>
        {art.instruction && <p className={styles.instruction}>{art.instruction}</p>}
        <details className={styles.prompt}>
          <summary>{m.inspector_panel_art_prompt()}</summary>
          <pre>{art.prompt}</pre>
        </details>
      </YStack>
    </XStack>
  )
}

function ArtImage({ url, alt }: { url: Promise<string | null>; alt: string }) {
  const resolved = use(url)
  return resolved === null ? (
    <span>{m.inspector_load_failed()}</span>
  ) : (
    <img src={resolved} alt={alt} />
  )
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { act } = await import('react')
  const {
    choose,
    inputLabelled,
    must,
    project,
    render,
    resolveAsset,
    samplePanel,
    selectLabelled,
    setValue,
  } = await import('./dom-harness')

  test('selectArtPatch adds when nothing is selected, replaces otherwise, and skips the same art', () => {
    expect(selectArtPatch(undefined, 'a')).toEqual([{ op: 'add', path: '/artId', value: 'a' }])
    expect(selectArtPatch('a', 'b')).toEqual([{ op: 'replace', path: '/artId', value: 'b' }])
    expect(selectArtPatch('a', 'a')).toEqual([])
  })

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
      expect(item.textContent).toContain(m.focus_point())
      expect(item.querySelector('button')).toBeNull()

      const select = must(
        container.querySelector<HTMLSelectElement>(
          `select[aria-label="${m.inspector_panel_cast_add()}"]`,
        ),
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

    test('each character in the cast has an acting field that adds, replaces and removes its acting', async () => {
      vi.useFakeTimers()
      const onChange = vi.fn<(patch: Patch) => void>()
      const focused = must(samplePanel.focusPoints.find((f) => f.characterId)?.characterId)
      const name = must(project.characters.find((c) => c.id === focused)).name
      const extra = { id: 'chr_extra', name: '通行人', shortName: '通' }
      const props = {
        characters: [...project.characters, extra],
        onChange,
        onGenerate: () => {},
        resolveAsset,
      }
      const { container, root } = await render(<PanelInspector panel={samplePanel} {...props} />)
      const field = (n: string) =>
        inputLabelled(container, m.inspector_panel_acting_label({ name: n }))
      expect(container.querySelectorAll(`[data-cast-id] input`)).toHaveLength(1)
      await act(async () => setValue(field(name), '振り向いて驚く'))
      await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS))
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'add', path: '/acting', value: [{ characterId: focused, text: '振り向いて驚く' }] },
      ])

      const acted: Panel = {
        ...samplePanel,
        acting: [{ characterId: focused, text: '振り向いて驚く' }],
      }
      await act(async () => root.render(<PanelInspector panel={acted} {...props} />))
      expect(field(name).value).toBe('振り向いて驚く')
      await act(async () => setValue(field(name), '笑う'))
      await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS))
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'replace', path: '/acting/0/text', value: '笑う' },
      ])
      await act(async () => setValue(field(name), ''))
      await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS))
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/acting' }])
      expect(() => field(extra.name)).toThrow()
    })

    test('removing a character from the cast also removes its acting', async () => {
      const onChange = vi.fn<(patch: Patch) => void>()
      const extra = { id: 'chr_extra', name: '通行人', shortName: '通' }
      const focused = must(samplePanel.focusPoints.find((f) => f.characterId)?.characterId)
      const { container } = await render(
        <PanelInspector
          panel={{
            ...samplePanel,
            cast: [focused, extra.id],
            acting: [
              { characterId: focused, text: '見上げる' },
              { characterId: extra.id, text: '通り過ぎる' },
            ],
          }}
          characters={[...project.characters, extra]}
          onChange={onChange}
          onGenerate={() => {}}
          resolveAsset={resolveAsset}
        />,
      )
      await act(async () =>
        must(container.querySelector<HTMLElement>(`[data-cast-id="${extra.id}"] button`)).click(),
      )
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'remove', path: '/cast/1' },
        { op: 'remove', path: '/acting/1' },
      ])
      // 焦点で登場キャラに残るキャラは、cast から外しても芝居を残す
      await act(async () =>
        must(container.querySelector<HTMLElement>(`[data-cast-id="${focused}"] button`)).click(),
      )
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/cast/0' }])
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
          (b) => b.getAttribute('aria-label') === m.remove(),
        ) as HTMLButtonElement | undefined

      const { container, root } = await render(<PanelInspector {...props} />)
      expect(removeOf(container, 'art_1')).toBeUndefined()

      await act(async () => root.render(<PanelInspector {...props} onRemoveArt={onRemoveArt} />))
      expect(removeOf(container, 'art_2')).toBeUndefined()
      await act(async () => must(removeOf(container, 'art_3')).click())
      expect(onRemoveArt).toHaveBeenCalledWith('art_3')
    })

    test('note is debounced DEBOUNCE_MS, order commits on Enter, an invalid order emits nothing', async () => {
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
      await act(async () => setValue(inputLabelled(container, m.panel_note()), 'メモ'))
      expect(onChange).not.toHaveBeenCalled()
      await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS - 1))
      expect(onChange).not.toHaveBeenCalled()
      await act(async () => vi.advanceTimersByTime(1))
      expect(onChange).toHaveBeenCalledWith([{ op: 'add', path: '/note', value: 'メモ' }])

      const order = inputLabelled(container, m.inspector_reading_order())
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

    test('the black checkbox adds and removes fill', async () => {
      const onChange = vi.fn<(patch: Patch) => void>()
      const props = {
        characters: project.characters,
        onChange,
        onGenerate: () => {},
        resolveAsset,
      }
      const checkboxIn = (container: HTMLElement) =>
        must(
          [...container.querySelectorAll('label')]
            .find((el) => el.textContent === m.panel_fill_black())
            ?.querySelector<HTMLInputElement>('input[type="checkbox"]'),
        )
      const { container, root } = await render(<PanelInspector panel={samplePanel} {...props} />)
      expect(checkboxIn(container).checked).toBe(false)
      await act(async () => checkboxIn(container).click())
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'add', path: '/fill', value: 'black' }])

      await act(async () =>
        root.render(<PanelInspector panel={{ ...samplePanel, fill: 'black' }} {...props} />),
      )
      expect(checkboxIn(container).checked).toBe(true)
      await act(async () => checkboxIn(container).click())
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/fill' }])
    })

    test('the frame select adds, replaces and removes frame', async () => {
      const onChange = vi.fn<(patch: Patch) => void>()
      const props = {
        characters: project.characters,
        onChange,
        onGenerate: () => {},
        resolveAsset,
      }
      const { container, root } = await render(<PanelInspector panel={samplePanel} {...props} />)
      const select = () => selectLabelled(container, m.panel_frame())
      expect(select().value).toBe('')
      await choose(select(), 'none')
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'add', path: '/frame', value: 'none' }])

      await act(async () =>
        root.render(<PanelInspector panel={{ ...samplePanel, frame: 'none' }} {...props} />),
      )
      expect(select().value).toBe('none')
      await choose(select(), 'wavy')
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'add', path: '/frame', value: 'wavy' }])
      await choose(select(), '')
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/frame' }])
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
      const generate = must(buttons.find((b) => b.textContent === m.generate()))
      const regenerate = must(buttons.find((b) => b.textContent === m.inspector_panel_regenerate()))
      expect(regenerate.disabled).toBe(true)
      await act(async () => generate.click())
      expect(onGenerate).toHaveBeenCalledWith()

      await act(async () =>
        setValue(inputLabelled(container, m.inspector_panel_instruction()), ' もっと暗く '),
      )
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
          .find((el) => el.textContent === m.inspector_panel_use_hint())
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
      expect(container.textContent).toContain(m.inspector_panel_bubbles_empty())
      expect(container.textContent).toContain(m.inspector_panel_history_empty())
    })
  })
}
