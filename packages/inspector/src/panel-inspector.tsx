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
import { Button, Checkbox, Field, IconButton, Select, TextArea, XStack, YStack } from '@manga/ui'
import { useId, useMemo, useState } from 'react'
import { DEBOUNCE_MS, NumberField, TextField } from './fields'
import styles from './panel-inspector.module.css'
import { optionalString, replace, swapOrder } from './patch'
import section from './section.module.css'
import type { PanelInspectorProps } from './types'
import { useAssetUrls } from './use-asset-urls'

const CAMERA_SUGGESTIONS = ['ロング', 'ミドル', 'バストアップ', 'アップ', 'アオリ', '俯瞰']

const isOrder = (n: number) => PanelSchema.shape.order.safeParse(n).success

/** `arts` の中から選ぶ。`artId` が無ければ add、あれば replace */
function selectArtPatch(artId: ID | undefined, next: ID): Patch {
  if (artId === next) return []
  return [{ op: artId === undefined ? 'add' : 'replace', path: '/artId', value: next }]
}

/** `cast` に足す。`cast` が無ければ配列ごと add */
function addCastPatch(cast: readonly ID[] | undefined, id: ID): Patch {
  if (cast === undefined) return [{ op: 'add', path: '/cast', value: [id] }]
  if (cast.includes(id)) return []
  return [{ op: 'add', path: '/cast/-', value: id }]
}

/** `cast` から外す。最後の 1 人なら `cast` ごと消す */
function removeCastPatch(cast: readonly ID[] | undefined, id: ID): Patch {
  const index = cast?.indexOf(id) ?? -1
  if (cast === undefined || index < 0) return []
  return [{ op: 'remove', path: cast.length === 1 ? '/cast' : `/cast/${index}` }]
}

const byOrder = (bubbles: readonly Bubble[]) =>
  bubbles
    .map((bubble, index) => ({ bubble, index }))
    .sort((a, b) => a.bubble.order - b.bubble.order)

const formatDate = (iso: string) => new Date(iso).toLocaleString('ja-JP')

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
  resolveAsset,
}: PanelInspectorProps) {
  const cameraListId = useId()
  const [instruction, setInstruction] = useState('')
  const refs = useMemo(() => panel.arts.map((a) => a.ref), [panel.arts])
  const urls = useAssetUrls(refs, resolveAsset)
  const current = currentArt(panel)
  const bubbles = byOrder(panel.bubbles)
  const speakerOf = (bubble: Bubble) =>
    characters.find((c) => c.id === bubble.speakerId)?.shortName ?? ''
  const arts = [...panel.arts].reverse()

  return (
    <div className={section.section} data-inspector="panel">
      <h3 className={section.title}>コマ {panel.order}</h3>
      <NumberField
        label="読み順"
        value={panel.order}
        min={1}
        step={1}
        isValid={isOrder}
        commitOnBlur
        onCommit={(n) => onChange(replace('/order', n))}
      />
      <TextField
        label="カメラ"
        value={panel.camera ?? ''}
        list={cameraListId}
        placeholder="ロング、アオリ、俯瞰…"
        onCommit={(v) => onChange(optionalString('/camera', panel.camera, v))}
      />
      <datalist id={cameraListId}>
        {CAMERA_SUGGESTIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <TextField
        label="指示メモ"
        value={panel.note ?? ''}
        rows={4}
        delayMs={DEBOUNCE_MS}
        onCommit={(v) => onChange(optionalString('/note', panel.note, v))}
      />
      <CastSection panel={panel} characters={characters} onChange={onChange} />
      {diagnosis && !diagnosis.bubbleOrderOk && (
        <p className={styles.hint} data-bubble-order-ok={false}>
          <small className={styles.hintWarning}>フキダシの順が読み順と合っていません</small>
        </p>
      )}

      <XStack as="h4" className={section.heading}>
        フキダシ
      </XStack>
      {bubbles.length === 0 ? (
        <p className={section.muted}>フキダシはありません</p>
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
                  {bubble.text.split('\n')[0] || '（空）'}
                </span>
                <IconButton
                  size="small"
                  label="フキダシを前へ"
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
                  label="フキダシを後へ"
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

      <XStack as="h4" className={section.heading}>
        生成
      </XStack>
      {diagnosis && (
        <>
          <p className={styles.hint} data-hint data-used={useHint}>
            {diagnosis.hint || <span className={section.muted}>ヒントはありません</span>}
          </p>
          <Checkbox
            label="ヒントを使う"
            checked={useHint}
            onChange={(e) => onUseHintChange?.(e.target.checked)}
          />
        </>
      )}
      {useReference !== undefined && (
        <Checkbox
          label="参考画像を使う"
          checked={useReference}
          onChange={(e) => onUseReferenceChange?.(e.target.checked)}
        />
      )}
      <XStack wrap className={section.group}>
        <Button variant="primary" disabled={generating} onClick={() => onGenerate()}>
          {generating ? '生成中…' : '生成'}
        </Button>
      </XStack>
      <Field label="修正指示">
        <TextArea
          rows={3}
          value={instruction}
          placeholder="採用中の絵に対する直し方"
          onChange={(e) => setInstruction(e.target.value)}
        />
      </Field>
      <XStack wrap className={section.group}>
        <Button
          disabled={generating || !current || instruction.trim() === ''}
          onClick={() => onGenerate(instruction.trim())}
        >
          修正して再生成
        </Button>
      </XStack>

      <XStack as="h4" className={section.heading}>
        履歴
      </XStack>
      {arts.length === 0 ? (
        <p className={section.muted}>まだ生成していません</p>
      ) : (
        <YStack as="ol" className={styles.arts}>
          {arts.map((art) => (
            <ArtItem
              key={art.id}
              art={art}
              url={urls.get(art.ref)}
              current={art.id === panel.artId}
              onSelect={() => {
                const patch = selectArtPatch(panel.artId, art.id)
                if (patch.length > 0) onChange(patch)
              }}
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
      panel.bubbles.some((b) => b.speakerId === id) && '台詞',
      panel.focusPoints.some((f) => f.characterId === id) && '焦点',
    ].filter((r): r is string => Boolean(r))
  return (
    <>
      <XStack as="h4" className={section.heading}>
        登場キャラ
      </XStack>
      {cast.length === 0 ? (
        <p className={section.muted}>登場キャラはいません</p>
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
                <small className={section.muted}>{reasons(character.id).join('・')}</small>
              </span>
              {panel.cast?.includes(character.id) && (
                <IconButton
                  size="small"
                  label={`${character.name} を登場キャラから外す`}
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
          aria-label="登場キャラを追加"
          className={section.group}
          value=""
          onChange={(e) => {
            if (e.target.value) onChange(addCastPatch(panel.cast, e.target.value))
          }}
        >
          <option value="">キャラを追加…</option>
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
}: {
  art: PanelArt
  url: string | null | undefined
  current: boolean
  onSelect(): void
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
        {url ? (
          <img src={url} alt={art.instruction ?? '生成した絵'} />
        ) : (
          <span>{url === null ? '読み込めません' : '読み込み中…'}</span>
        )}
      </button>
      <YStack gap={4} className={styles.meta}>
        <XStack as="span" className={styles.metaHead}>
          <time dateTime={art.createdAt}>{formatDate(art.createdAt)}</time>
          {current && <b className={styles.badge}>採用中</b>}
        </XStack>
        {art.instruction && <p className={styles.instruction}>{art.instruction}</p>}
        <details className={styles.prompt}>
          <summary>プロンプト</summary>
          <pre>{art.prompt}</pre>
        </details>
      </YStack>
    </XStack>
  )
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('selectArtPatch adds when nothing is selected, replaces otherwise, and skips the same art', () => {
    expect(selectArtPatch(undefined, 'a')).toEqual([{ op: 'add', path: '/artId', value: 'a' }])
    expect(selectArtPatch('a', 'b')).toEqual([{ op: 'replace', path: '/artId', value: 'b' }])
    expect(selectArtPatch('a', 'a')).toEqual([])
  })

  test('addCastPatch creates the array first and skips a character already in it', () => {
    expect(addCastPatch(undefined, 'a')).toEqual([{ op: 'add', path: '/cast', value: ['a'] }])
    expect(addCastPatch(['a'], 'b')).toEqual([{ op: 'add', path: '/cast/-', value: 'b' }])
    expect(addCastPatch(['a'], 'a')).toEqual([])
  })

  test('removeCastPatch removes by index and drops the array with the last character', () => {
    expect(removeCastPatch(['a', 'b'], 'b')).toEqual([{ op: 'remove', path: '/cast/1' }])
    expect(removeCastPatch(['a'], 'a')).toEqual([{ op: 'remove', path: '/cast' }])
    expect(removeCastPatch(['a'], 'b')).toEqual([])
    expect(removeCastPatch(undefined, 'a')).toEqual([])
  })
}
