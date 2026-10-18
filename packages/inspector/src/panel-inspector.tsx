import { getLocale, m } from '@manga/i18n'
import {
  type Bubble,
  type Character,
  currentArt,
  type ID,
  type Panel,
  type PanelArt,
  PanelSchema,
  type Patch,
  panelCharacterIds,
} from '@manga/schema'
import {
  Button,
  Checkbox,
  IconButton,
  Select,
  TextArea,
  Typography,
  XStack,
  YStack,
} from '@manga/ui'
import { Suspense, use, useId, useState } from 'react'
import { assetUrl } from './asset-url'
import { DEBOUNCE_MS, NumberField, TextField } from './fields'
import styles from './panel-inspector.module.css'
import { addCastPatch, optionalString, removeCastPatch, replace, swapOrder } from './patch'
import section from './section.module.css'
import type { PanelInspectorProps } from './types'

const CAMERA_SUGGESTIONS = [
  m.inspector_panel_camera_long,
  m.inspector_panel_camera_middle,
  m.inspector_panel_camera_bust,
  m.inspector_panel_camera_close_up,
  m.inspector_panel_camera_low_angle,
  m.inspector_panel_camera_high_angle,
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
  const cameraListId = useId()
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
      <TextField
        label={m.inspector_panel_camera()}
        value={panel.camera ?? ''}
        list={cameraListId}
        placeholder={m.inspector_panel_camera_placeholder()}
        onCommit={(v) => onChange(optionalString('/camera', panel.camera, v))}
      />
      <datalist id={cameraListId}>
        {CAMERA_SUGGESTIONS.map((camera) => (
          <option key={camera()} value={camera()} />
        ))}
      </datalist>
      <TextField
        label={m.inspector_panel_note()}
        value={panel.note ?? ''}
        rows={4}
        delayMs={DEBOUNCE_MS}
        onCommit={(v) => onChange(optionalString('/note', panel.note, v))}
      />
      <CastSection panel={panel} characters={characters} onChange={onChange} />
      {diagnosis && !diagnosis.bubbleOrderOk && (
        <p className={styles.hint} data-bubble-order-ok={false}>
          <small className={styles.hintWarning}>{m.inspector_panel_bubble_order_mismatch()}</small>
        </p>
      )}

      <Typography variant="label" tone="muted" className={section.heading}>
        {m.inspector_panel_bubbles()}
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
                  {bubble.text.split('\n')[0] || m.inspector_panel_bubble_empty_text()}
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
        {m.inspector_generate()}
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
          {generating ? m.inspector_generating() : m.inspector_generate()}
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
        {m.inspector_panel_history()}
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
 * 登場キャラの一覧と追加。台詞か焦点から拾えるキャラは理由を添えて並べ、`cast` に入れたキャラだけ外せる
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
      panel.focusPoints.some((f) => f.characterId === id) && m.inspector_focus(),
    ].filter((r) => r !== false)
  return (
    <>
      <Typography variant="label" tone="muted" className={section.heading}>
        {m.inspector_panel_cast()}
      </Typography>
      {cast.length === 0 ? (
        <Typography tone="muted">{m.inspector_panel_cast_empty()}</Typography>
      ) : (
        <YStack as="ul" gap={2} className={styles.bubbles}>
          {cast.map((character) => (
            <XStack
              as="li"
              key={character.id}
              className={styles.bubble}
              data-cast-id={character.id}
            >
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
                  onClick={() => onChange(removeCastPatch(panel.cast, character.id))}
                >
                  ×
                </IconButton>
              )}
            </XStack>
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
        <Suspense fallback={<span>{m.inspector_loading()}</span>}>
          <ArtImage url={url} alt={art.instruction ?? m.inspector_panel_art_alt()} />
        </Suspense>
      </button>
      <YStack gap={4} className={styles.meta}>
        <XStack as="span" className={styles.metaHead}>
          <time dateTime={art.createdAt}>{formatDate(art.createdAt)}</time>
          {current && <b className={styles.badge}>{m.inspector_panel_art_current()}</b>}
          {onRemove && (
            <Button size="small" variant="ghost" className={styles.remove} onClick={onRemove}>
              {m.inspector_remove()}
            </Button>
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
  const { expect, test } = import.meta.vitest

  test('selectArtPatch adds when nothing is selected, replaces otherwise, and skips the same art', () => {
    expect(selectArtPatch(undefined, 'a')).toEqual([{ op: 'add', path: '/artId', value: 'a' }])
    expect(selectArtPatch('a', 'b')).toEqual([{ op: 'replace', path: '/artId', value: 'b' }])
    expect(selectArtPatch('a', 'a')).toEqual([])
  })
}
