import { Button, Typography } from '@manga/ui'
import styles from './character-inspector.module.css'
import { DEBOUNCE_MS, Group, TextField } from './fields'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { CharacterInspectorProps } from './types'
import { useAssetUrls } from './use-asset-urls'

/**
 * 参照画像が無いキャラに出す既定の画像。キャラごとの見た目を持たないので生成には送らず、
 * 選ぶか生成するまでの置き場として出す
 */
function DefaultReference() {
  return (
    <svg
      className={styles.reference}
      viewBox="0 0 60 80"
      role="img"
      aria-label="既定の画像"
      data-default-reference
    >
      <circle cx="30" cy="18" r="9" />
      <path d="M14 76 V44 a16 14 0 0 1 32 0 V76 Z" />
    </svg>
  )
}

export function CharacterInspector({
  character,
  onChange,
  onPickReference,
  onGenerateReference,
  generating = false,
  resolveAsset,
}: CharacterInspectorProps) {
  const ref = character.referenceRef
  const urls = useAssetUrls(ref === undefined ? [] : [ref], resolveAsset)
  const url = ref === undefined ? undefined : urls.get(ref)
  return (
    <div className={section.section} data-inspector="character">
      <Typography variant="subheading" className={section.title}>
        {character.name || 'キャラクター'}
      </Typography>
      <TextField
        label="名前"
        value={character.name}
        required
        onCommit={(v) => v !== character.name && onChange(replace('/name', v))}
      />
      <TextField
        label="略称"
        value={character.shortName}
        required
        onCommit={(v) => v !== character.shortName && onChange(replace('/shortName', v))}
      />
      <TextField
        label="外見"
        value={character.appearance ?? ''}
        rows={4}
        delayMs={DEBOUNCE_MS}
        placeholder="生成プロンプトに入る"
        onCommit={(v) => onChange(optionalString('/appearance', character.appearance, v))}
      />
      <Group label="参照画像">
        {ref === undefined ? (
          <DefaultReference />
        ) : url ? (
          <img className={styles.reference} src={url} alt={`${character.name} の参照画像`} />
        ) : (
          <Typography as="span" tone="muted">
            {url === null ? '読み込めません' : '読み込み中…'}
          </Typography>
        )}
        <Button size="small" disabled={generating} onClick={onPickReference}>
          {ref === undefined ? '画像を選ぶ' : '差し替え'}
        </Button>
        <Button
          size="small"
          disabled={generating || !character.appearance}
          title={character.appearance ? undefined : '外見を入れると生成できます'}
          onClick={onGenerateReference}
        >
          {generating ? '生成中…' : '外見から生成'}
        </Button>
        {ref !== undefined && (
          <Button
            size="small"
            variant="ghost"
            disabled={generating}
            onClick={() => onChange([{ op: 'remove', path: '/referenceRef' }])}
          >
            外す
          </Button>
        )}
      </Group>
      <TextField
        label="メモ"
        value={character.note ?? ''}
        rows={3}
        delayMs={DEBOUNCE_MS}
        onCommit={(v) => onChange(optionalString('/note', character.note, v))}
      />
    </div>
  )
}
