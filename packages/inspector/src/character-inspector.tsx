import { DEBOUNCE_MS, Group, TextField } from './fields'
import { optionalString, replace } from './patch'
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
    <div className="inspector-section" data-inspector="character">
      <h3>{character.name || 'キャラクター'}</h3>
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
          <span className="in-muted">なし</span>
        ) : url ? (
          <img className="in-reference" src={url} alt={`${character.name} の参照画像`} />
        ) : (
          <span className="in-muted">{url === null ? '読み込めません' : '読み込み中…'}</span>
        )}
        <button type="button" onClick={onPickReference}>
          {ref === undefined ? '選ぶ' : '差し替え'}
        </button>
        {ref !== undefined && (
          <button type="button" onClick={() => onChange([{ op: 'remove', path: '/referenceRef' }])}>
            外す
          </button>
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
