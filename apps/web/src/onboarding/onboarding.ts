import type { ImageProvider } from '@manga/ai'
import { currentArt, type ID, type Panel, type Project, parseProject } from '@manga/schema'
import { createMemoryStorage } from '@manga/storage'
import { createPanelGeneration, type PanelGeneration } from '../generate-panel'
import { exportProjectJson } from '../project-file'
import { createProjectLibrary, type ProjectLibrary } from '../project-library'
import type { WebProjectStore } from '../store/project-store'
import { createZip, type ZipEntry } from '../zip'
import source from './project.json'

export interface Onboarding {
  library: ProjectLibrary
  store: WebProjectStore
  generation: PanelGeneration
  projectId: ID
  pageId: ID
}

// ログインとサインアウトで loader が読み直されても、生成したネームを消さない
const sessions = new WeakMap<ImageProvider, Promise<Onboarding>>()

/**
 * オンボーディングのプロジェクトを、利用者のプロジェクト一覧に混ざらないメモリ上のライブラリで開く。
 * 生成は `imageProvider` で行い、同じ `imageProvider` には同じセッションを返す
 */
export function openOnboarding(imageProvider: ImageProvider): Promise<Onboarding> {
  let session = sessions.get(imageProvider)
  if (!session) {
    session = start(imageProvider)
    sessions.set(imageProvider, session)
  }
  return session
}

async function start(imageProvider: ImageProvider): Promise<Onboarding> {
  const library = createProjectLibrary(createMemoryStorage())
  const project = await library.import(parseProject(source))
  const store = await library.open(project.id)
  const pageId = project.episodes[0]?.pages[0]?.id
  if (!store || !pageId) throw new Error('onboarding project has no page')
  return {
    library,
    store,
    generation: createPanelGeneration({ library, imageProvider }),
    projectId: project.id,
    pageId,
  }
}

/**
 * 生成したネームを固定のコンテンツにするための zip。`project.json` と、コマごとの採用中の絵 `art/<panelId>.png`。
 * 絵は採用中の 1 枚だけを残し、ref を zip 内のパスに書き換える
 */
export async function exportOnboarding(
  project: Project,
  loadAsset: (ref: string) => Promise<Blob>,
): Promise<Blob> {
  const arts: ZipEntry[] = []
  const keepCurrent = async ({ artId, ...panel }: Panel): Promise<Panel> => {
    const art = currentArt({ ...panel, artId })
    if (!art) return { ...panel, arts: [] }
    const name = `art/${panel.id}.png`
    arts.push({ name, data: new Uint8Array(await (await loadAsset(art.ref)).arrayBuffer()) })
    return { ...panel, arts: [{ ...art, ref: name }], artId: art.id }
  }
  const episodes = await Promise.all(
    project.episodes.map(async (episode) => ({
      ...episode,
      pages: await Promise.all(
        episode.pages.map(async (page) => ({
          ...page,
          panels: await Promise.all(page.panels.map(keepCurrent)),
        })),
      ),
    })),
  )
  const json = new TextEncoder().encode(exportProjectJson({ ...project, episodes }))
  return createZip([{ name: 'project.json', data: json }, ...arts])
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { createFakeImageProvider } = await import('@manga/ai')

  test('同じ ImageProvider には同じセッションを返し、プロジェクトはメモリの外に書かない', async () => {
    const imageProvider = createFakeImageProvider()
    const a = await openOnboarding(imageProvider)
    expect(await openOnboarding(imageProvider)).toBe(a)
    expect(await openOnboarding(createFakeImageProvider())).not.toBe(a)
    expect(a.store.get().episodes[0]?.pages[0]?.panels).toHaveLength(5)
  })

  test('どのコマにも焦点と誘導線がある', async () => {
    const { store } = await openOnboarding(createFakeImageProvider())
    const panels = store.get().episodes[0]?.pages[0]?.panels ?? []
    expect(panels.every((p) => p.focusPoints.length > 0 && p.vectors.length > 0)).toBe(true)
  })

  test('生成するとコマに絵が入り、zip には採用中の絵だけが入る', async () => {
    const session = await openOnboarding(createFakeImageProvider())
    const { store, generation, projectId, pageId, library } = session
    const run = () =>
      generation.generateAll({
        store,
        projectId,
        scope: 'onboarding',
        pageIds: [pageId],
        includeGenerated: true,
      })
    expect(await run()).toMatchObject({ done: 5 })
    expect(await run()).toMatchObject({ done: 5 })
    const project = store.get()
    expect(project.episodes[0]?.pages[0]?.panels.every((p) => p.arts.length === 2)).toBe(true)

    const zip = new Uint8Array(
      await (await exportOnboarding(project, library.loadAsset)).arrayBuffer(),
    )
    const text = new TextDecoder().decode(zip)
    expect(text).toContain('project.json')
    expect(text).toContain('"ref": "art/pn_1.png"')
    expect(text).not.toContain('blob:')
    expect(text.match(/art\/pn_\d\.png/g)?.length).toBeGreaterThanOrEqual(10)
  })
}
