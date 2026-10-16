import { fixtures, type ID, type Page, type Patch } from '@manga/schema'
import '@manga/ui/tokens.css'
import '@manga/ui/base.css'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorCanvas } from '../editor-canvas'
import type { Layers, Selection, Tool } from '../types'

const project = fixtures.samplePage01
const samplePage = project.episodes[0]?.pages[0] as Page

/** 全コマに docs/fixtures/art/<panelId>.png を採用したページ */
function withFixtureArts(page: Page): Page {
  return {
    ...page,
    panels: page.panels.map((panel) => ({
      ...panel,
      arts: [
        {
          id: `art_${panel.id}`,
          ref: `fixture:${panel.id}`,
          provider: 'fixture',
          prompt: '',
          createdAt: '2026-10-16T00:00:00.000Z',
        },
      ],
      artId: `art_${panel.id}`,
    })),
  }
}

const resolveAsset = async (ref: string) =>
  new URL(`../../../../docs/fixtures/art/${ref.replace(/^fixture:/, '')}.png`, import.meta.url).href

/** page を root とした JSON Patch を当てる。プレイグラウンドで onChange を確かめるためだけのもの */
function applyPatch(page: Page, patch: Patch): Page {
  const next = structuredClone(page) as unknown as Record<string, unknown>
  for (const op of patch) {
    const keys = op.path
      .split('/')
      .slice(1)
      .map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~'))
    const last = keys.pop()
    if (last === undefined) continue
    let parent: unknown = next
    for (const k of keys) parent = (parent as Record<string, unknown>)[k]
    if (Array.isArray(parent)) {
      const i = last === '-' ? parent.length : Number(last)
      if (op.op === 'add') parent.splice(i, 0, op.value)
      else if (op.op === 'remove') parent.splice(i, 1)
      else parent[i] = op.value
    } else {
      const obj = parent as Record<string, unknown>
      if (op.op === 'remove') Reflect.deleteProperty(obj, last)
      else obj[last] = op.value
    }
  }
  return next as unknown as Page
}

function Playground() {
  const [page, setPage] = useState(samplePage)
  const [selection, setSelection] = useState<Selection>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [generating, setGenerating] = useState<Set<ID>>(() => new Set())
  const [layers, setLayers] = useState<Layers>({
    reference: true,
    art: true,
    scribble: true,
    hints: true,
    diagnosis: true,
  })

  const toggleGenerating = (id: ID) =>
    setGenerating((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 12, padding: 8, alignItems: 'center' }}>
        <button type="button" onClick={() => setPage(withFixtureArts(page))}>
          フィクスチャ画像を入れる
        </button>
        <button type="button" onClick={() => setPage(samplePage)}>
          リセット
        </button>
        <label>
          <input
            type="checkbox"
            checked={layers.art}
            onChange={(e) => setLayers({ ...layers, art: e.target.checked })}
          />
          art
        </label>
        <select value={tool} onChange={(e) => setTool(e.target.value as Tool)}>
          {(['select', 'panel', 'bubble'] as const).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span>
          ホイールでズーム、Space + ドラッグでパン。クリックで選択、Delete で削除、矢印キーで移動。
          panel ツールはドラッグで作成、ハンドルでリサイズ、ボタンで分割、Shift + クリックで結合。
          「生成」でスピナーを切り替える
        </span>
        <span>選択: {selection ? `${selection.kind} ${selection.id}` : 'なし'}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <EditorCanvas
          page={page}
          settings={project.settings}
          characters={project.characters}
          diagnosis={null}
          selection={selection}
          tool={tool}
          layers={layers}
          generating={generating}
          onChange={(patch) => {
            console.log('onChange', patch)
            setPage((p) => applyPatch(p, patch))
          }}
          onSelect={setSelection}
          onGenerate={toggleGenerating}
          resolveAsset={resolveAsset}
        />
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
