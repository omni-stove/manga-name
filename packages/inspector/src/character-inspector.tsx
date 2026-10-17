import { Button, Typography } from '@manga/ui'
import styles from './character-inspector.module.css'
import { DEBOUNCE_MS, Group, TextField } from './fields'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { CharacterInspectorProps } from './types'
import { useAssetUrls } from './use-asset-urls'

export function CharacterInspector({
  character,
  onChange,
  onPickReference,
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
          <Typography as="span" tone="muted">
            なし
          </Typography>
        ) : url ? (
          <img className={styles.reference} src={url} alt={`${character.name} の参照画像`} />
        ) : (
          <Typography as="span" tone="muted">
            {url === null ? '読み込めません' : '読み込み中…'}
          </Typography>
        )}
        <Button size="small" onClick={onPickReference}>
          {ref === undefined ? '選ぶ' : '差し替え'}
        </Button>
        {ref !== undefined && (
          <Button
            size="small"
            variant="ghost"
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
