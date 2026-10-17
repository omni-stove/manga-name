import {
  type Bubble,
  currentArt,
  type ID,
  type PanelArt,
  PanelSchema,
  type Patch,
} from '@manga/schema'
import { Button, Checkbox, IconButton, TextArea, Typography, XStack, YStack } from '@manga/ui'
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
      <Typography variant="subheading" className={section.title}>
        コマ {panel.order}
      </Typography>
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
      {diagnosis && !diagnosis.bubbleOrderOk && (
        <p className={styles.hint} data-bubble-order-ok={false}>
          <small className={styles.hintWarning}>フキダシの順が読み順と合っていません</small>
        </p>
      )}

      <Typography variant="label" tone="muted" className={section.heading}>
        フキダシ
      </Typography>
      {bubbles.length === 0 ? (
        <Typography tone="muted">フキダシはありません</Typography>
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

      <Typography variant="label" tone="muted" className={section.heading}>
        生成
      </Typography>
      {diagnosis && (
        <>
          <p className={styles.hint} data-hint data-used={useHint}>
            {diagnosis.hint || (
              <Typography as="span" tone="muted">
                ヒントはありません
              </Typography>
            )}
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
      <TextArea
        label="修正指示"
        rows={3}
        value={instruction}
        placeholder="採用中の絵に対する直し方"
        onChange={(e) => setInstruction(e.target.value)}
      />
      <XStack wrap className={section.group}>
        <Button
          disabled={generating || !current || instruction.trim() === ''}
          onClick={() => onGenerate(instruction.trim())}
        >
          修正して再生成
        </Button>
      </XStack>

      <Typography variant="label" tone="muted" className={section.heading}>
        履歴
      </Typography>
      {arts.length === 0 ? (
        <Typography tone="muted">まだ生成していません</Typography>
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
}
