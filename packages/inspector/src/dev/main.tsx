import { fixtures, type Page, type Patch } from '@manga/schema'
import { Typography } from '@manga/ui'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@manga/ui/tokens.css'
import '@manga/ui/base.css'
import { BubbleInspector } from '../bubble-inspector'
import { CharacterInspector } from '../character-inspector'
import { PageInspector } from '../page-inspector'
import { PanelInspector } from '../panel-inspector'
import { ProjectSettingsInspector } from '../project-settings-inspector'

const project = fixtures.samplePage01
const page = project.episodes[0]?.pages[0] as Page
const character = project.characters[0]
const panelIds = page.panels.map((p) => p.id)

/** 各コマに fixtures/art/<panelId>.png を 3 版ずつ持たせ、2 版目を採用した状態 */
const withArts = (panel: Page['panels'][number]) => ({
  ...panel,
  arts: [1, 2, 3].map((n) => ({
    id: `art_${panel.id}_${n}`,
    ref: `fixture:${panel.id}`,
    provider: 'fixture',
    prompt: `${panel.note ?? ''}\nstyle: ${project.settings.style.prompt}`,
    instruction: n === 1 ? undefined : `${n} 版目の修正指示`,
    createdAt: `2026-10-16T0${n}:00:00.000Z`,
  })),
  artId: `art_${panel.id}_2`,
})

const resolveAsset = async (ref: string) =>
  new URL(`../../../../fixtures/art/${ref.replace(/^fixture:/, '')}.png`, import.meta.url).href

type View = { kind: 'panel' | 'bubble'; id: string } | { kind: 'page' | 'character' | 'settings' }

function Playground() {
  const [view, setView] = useState<View>({ kind: 'panel', id: panelIds[0] ?? '' })
  const [log, setLog] = useState<string[]>([])
  const onChange = (patch: Patch) => setLog((l) => [JSON.stringify(patch), ...l].slice(0, 30))
  const panels = page.panels.map(withArts)
  const panel = view.kind === 'panel' ? panels.find((p) => p.id === view.id) : undefined
  const bubblePanel =
    view.kind === 'bubble' ? panels.find((p) => p.bubbles.some((b) => b.id === view.id)) : undefined
  const bubble = bubblePanel?.bubbles.find((b) => view.kind === 'bubble' && b.id === view.id)

  return (
    <div className="playground">
      <div>
        <p className="nav">
          {panels.map((p) => (
            <button key={p.id} type="button" onClick={() => setView({ kind: 'panel', id: p.id })}>
              コマ {p.order}
            </button>
          ))}
          {panels
            .flatMap((p) => p.bubbles)
            .map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setView({ kind: 'bubble', id: b.id })}
              >
                フキダシ {b.id}
              </button>
            ))}
          <button type="button" onClick={() => setView({ kind: 'page' })}>
            ページ
          </button>
          <button type="button" onClick={() => setView({ kind: 'character' })}>
            キャラクター
          </button>
          <button type="button" onClick={() => setView({ kind: 'settings' })}>
            設定
          </button>
        </p>
        {panel && (
          <PanelInspector
            panel={panel}
            characters={project.characters}
            onChange={onChange}
            onGenerate={(instruction) => console.log('onGenerate', instruction)}
            resolveAsset={resolveAsset}
          />
        )}
        {bubble && bubblePanel && (
          <BubbleInspector
            bubble={bubble}
            characters={project.characters}
            frame={{ panel: bubblePanel, pageSize: project.settings.pageSize }}
            onChange={onChange}
          />
        )}
        {view.kind === 'page' && (
          <PageInspector
            page={page}
            onChange={onChange}
            onGenerateAll={() => console.log('onGenerateAll')}
            onPickReference={() => console.log('onPickReference')}
          />
        )}
        {view.kind === 'character' && character && (
          <CharacterInspector
            character={character}
            onChange={onChange}
            onPickReference={() => console.log('onPickReference')}
            onGenerateReference={() => console.log('onGenerateReference')}
            resolveAsset={resolveAsset}
          />
        )}
        {view.kind === 'settings' && (
          <ProjectSettingsInspector settings={project.settings} onChange={onChange} />
        )}
      </div>
      <div>
        <Typography variant="subheading">onChange</Typography>
        <pre>{log.join('\n')}</pre>
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Playground />
    </StrictMode>,
  )
}
