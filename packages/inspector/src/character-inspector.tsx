import { m } from '@manga/i18n'
import { Button, Typography } from '@manga/ui'
import { Suspense, use } from 'react'
import { assetUrl } from './asset-url'
import styles from './character-inspector.module.css'
import { DEBOUNCE_MS, Group, TextField } from './fields'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { CharacterInspectorProps } from './types'

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
      aria-label={m.inspector_character_default_reference()}
      data-default-reference
    >
      <circle cx="30" cy="18" r="9" />
      <path d="M14 76 V44 a16 14 0 0 1 32 0 V76 Z" />
    </svg>
  )
}

function Reference({ url, alt }: { url: Promise<string | null>; alt: string }) {
  const resolved = use(url)
  if (resolved === null)
    return (
      <Typography as="span" tone="muted">
        {m.inspector_load_failed()}
      </Typography>
    )
  return <img className={styles.reference} src={resolved} alt={alt} />
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
  return (
    <div className={section.section} data-inspector="character">
      <Typography variant="subheading" className={section.title}>
        {character.name || m.inspector_character_untitled()}
      </Typography>
      <TextField
        label={m.character_name()}
        value={character.name}
        required
        onCommit={(v) => v !== character.name && onChange(replace('/name', v))}
      />
      <TextField
        label={m.character_short_name()}
        value={character.shortName}
        required
        onCommit={(v) => v !== character.shortName && onChange(replace('/shortName', v))}
      />
      <TextField
        label={m.character_appearance()}
        value={character.appearance ?? ''}
        rows={4}
        delayMs={DEBOUNCE_MS}
        placeholder={m.inspector_character_appearance_placeholder()}
        onCommit={(v) => onChange(optionalString('/appearance', character.appearance, v))}
      />
      <Group label={m.character_reference()}>
        {ref === undefined ? (
          <DefaultReference />
        ) : (
          <Suspense
            fallback={
              <Typography as="span" tone="muted">
                {m.loading()}
              </Typography>
            }
          >
            <Reference
              url={assetUrl(resolveAsset, ref)}
              alt={m.inspector_character_reference_alt({ name: character.name })}
            />
          </Suspense>
        )}
        <Button size="small" disabled={generating} onClick={onPickReference}>
          {ref === undefined ? m.inspector_character_reference_pick() : m.inspector_replace()}
        </Button>
        <Button
          size="small"
          disabled={generating || !character.appearance}
          title={
            character.appearance ? undefined : m.inspector_character_generate_needs_appearance()
          }
          onClick={onGenerateReference}
        >
          {generating ? m.generating() : m.inspector_character_generate_reference()}
        </Button>
        {ref !== undefined && (
          <Button
            size="small"
            variant="ghost"
            disabled={generating}
            onClick={() => onChange([{ op: 'remove', path: '/referenceRef' }])}
          >
            {m.detach()}
          </Button>
        )}
      </Group>
      <TextField
        label={m.character_note()}
        value={character.note ?? ''}
        rows={3}
        delayMs={DEBOUNCE_MS}
        onCommit={(v) => onChange(optionalString('/note', character.note, v))}
      />
    </div>
  )
}
