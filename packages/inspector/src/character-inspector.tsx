// @vitest-environment jsdom
import { m } from '@manga/i18n'
import type { Patch } from '@manga/schema'
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

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { act } = await import('react')
  const { buttonNamed, inputLabelled, must, project, render, resolveAsset, setValue } =
    await import('./dom-harness')

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
      const name = inputLabelled(container, m.character_name())
      await act(async () => setValue(name, ' '))
      expect(name.getAttribute('aria-invalid')).toBe('true')
      expect(onChange).not.toHaveBeenCalled()
      await act(async () => setValue(name, 'エル'))
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/name', value: 'エル' }])

      await act(async () => setValue(inputLabelled(container, m.character_short_name()), 'L'))
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/shortName', value: 'L' }])
    })

    test('titles an unnamed character with the untitled label', async () => {
      const { container } = await render(
        <CharacterInspector
          character={{ ...character, name: '' }}
          onChange={() => {}}
          onPickReference={() => {}}
          onGenerateReference={() => {}}
          resolveAsset={resolveAsset}
        />,
      )
      expect(must(container.querySelector('[data-inspector="character"]')).textContent).toContain(
        m.inspector_character_untitled(),
      )
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
      await act(async () => setValue(inputLabelled(container, m.character_appearance()), ''))
      await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS - 1))
      expect(onChange).not.toHaveBeenCalled()
      await act(async () => vi.advanceTimersByTime(1))
      expect(onChange).toHaveBeenCalledWith([{ op: 'remove', path: '/appearance' }])

      await act(async () => setValue(inputLabelled(container, m.character_note()), '口数が少ない'))
      await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS))
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'add', path: '/note', value: '口数が少ない' },
      ])
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
      const group = must(
        container.querySelector(`[role="group"][aria-label="${m.character_reference()}"]`),
      )
      expect(group.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
        m.inspector_character_default_reference(),
      )
      expect(group.querySelector('img')).toBeNull()
      await act(async () => buttonNamed(container, m.inspector_character_reference_pick()).click())
      expect(onPickReference).toHaveBeenCalledTimes(1)
      await act(async () =>
        buttonNamed(container, m.inspector_character_generate_reference()).click(),
      )
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
      expect(button(bare.container, m.inspector_character_generate_reference()).disabled).toBe(true)
      expect(button(bare.container, m.inspector_character_reference_pick()).disabled).toBe(false)

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
      expect(button(busy.container, m.generating()).disabled).toBe(true)
      expect(button(busy.container, m.inspector_character_reference_pick()).disabled).toBe(true)
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
      expect(img.getAttribute('alt')).toBe(
        m.inspector_character_reference_alt({ name: character.name }),
      )
      expect(buttonNamed(container, m.inspector_replace())).toBeTruthy()
      await act(async () => buttonNamed(container, m.detach()).click())
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
      expect(container.textContent).toContain(m.inspector_load_failed())
    })
  })
}
