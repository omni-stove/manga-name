import { exportPdf, type RenderContext, type RenderOptions, renderPage } from '@manga/render'
import { currentArt, type ID, type Page, type Project } from '@manga/schema'
import { createZip } from './zip'

export type ExportFormat = 'png' | 'pdf'

/**
 * Worker に渡す書き出しの入力。関数は postMessage を越えられないので、
 * 描画が読む採用中の絵をメインスレッドで先に読み、ref をキーにして同梱する
 */
export interface ExportJob {
  format: ExportFormat
  /** 描画に要る settings と characters、対象エピソードだけを残した Project */
  project: Project
  episodeId: ID
  /** 書き出すページ。エピソード内の並び順 */
  pageIds: ID[]
  opts: RenderOptions & { spread: boolean }
  assets: Record<string, Blob>
}

export interface ExportRequest {
  id: number
  job: ExportJob
}

export type ExportReply =
  | { id: number; kind: 'progress'; done: number; total: number }
  | { id: number; kind: 'done'; blob: Blob }
  | { id: number; kind: 'error'; message: string }

/** 書き出し対象のページから採用中の絵を読み、ExportJob にする。アセットは対象ページの分だけ */
export async function collectExportJob(
  project: Project,
  episodeId: ID,
  pageIds: ID[],
  format: ExportFormat,
  opts: ExportJob['opts'],
  loadAsset: RenderContext['loadAsset'],
): Promise<ExportJob> {
  const episode = project.episodes.find((e) => e.id === episodeId)
  if (!episode) throw new Error(`episode ${episodeId} is not in the project`)
  const wanted = new Set(pageIds)
  const pages = episode.pages.filter((p) => wanted.has(p.id))
  const refs = [
    ...new Set(pages.flatMap((page) => page.panels.flatMap((p) => currentArt(p)?.ref ?? []))),
  ]
  const loaded = await Promise.all(refs.map(async (ref) => [ref, await loadAsset(ref)] as const))
  return {
    format,
    project: { ...project, episodes: [episode] },
    episodeId,
    pageIds: pages.map((p) => p.id),
    opts,
    assets: Object.fromEntries(loaded),
  }
}

/** 採用中の絵が無いコマの数。書き出しは止めず、ダイアログで警告するのに使う */
export function countMissingArts(pages: readonly Page[]): number {
  return pages.reduce((sum, page) => sum + page.panels.filter((p) => !currentArt(p)).length, 0)
}

/** PNG の zip に入れる名前。`p03.png` の形で、ページ番号はエピソード内の 1 始まり */
const zipEntryName = (number: number) => `p${String(number).padStart(2, '0')}.png`

/**
 * ExportJob から書き出しのファイルを作る。PDF は exportPdf、PNG は 1 ページならその PNG、
 * 複数なら zip。1 ページ描き終えるごとに onProgress を呼ぶ。
 * Worker の中で呼ぶが、同梱したアセットしか読まないのでメインスレッドでも同じバイト列になる
 */
export async function runExportJob(
  job: ExportJob,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<Blob> {
  const loadAsset = async (ref: string) => {
    const blob = job.assets[ref]
    if (!blob) throw new Error(`asset ${ref} was not bundled into the export job`)
    return blob
  }
  if (job.format === 'pdf') {
    return exportPdf(job.project, job.episodeId, {
      ...job.opts,
      pages: job.pageIds,
      loadAsset,
      onProgress,
    })
  }
  const ctx: RenderContext = {
    settings: job.project.settings,
    characters: job.project.characters,
    loadAsset,
  }
  const pages = job.project.episodes.find((e) => e.id === job.episodeId)?.pages ?? []
  const wanted = new Set(job.pageIds)
  const targets = pages.flatMap((page, i) => (wanted.has(page.id) ? [{ page, number: i + 1 }] : []))
  const entries = []
  for (const { page, number } of targets) {
    const png = await renderPage(page, ctx, job.opts)
    entries.push({ name: zipEntryName(number), png })
    onProgress(entries.length, targets.length)
  }
  const [only] = entries
  if (entries.length === 1 && only) return only.png
  return createZip(
    await Promise.all(
      entries.map(async (e) => ({ name: e.name, data: new Uint8Array(await e.png.arrayBuffer()) })),
    ),
  )
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const { readFile } = await import('node:fs/promises')

  const fixture = fixtures.samplePage01
  const episode = fixture.episodes[0]
  const emptyPage = episode?.pages[0]
  if (!episode || !emptyPage) throw new Error('fixture にページがない')
  // base を import.meta.url のまま渡すと、このブロックが本番ビルドで消える前に Vite がディレクトリを資産として探して警告する
  const artDir = new URL('../../../docs/fixtures/art/', String(import.meta.url))
  const opts: ExportJob['opts'] = { width: 364, notes: 'margin', panelNumbers: true, spread: false }

  const pageWithArts: Page = {
    ...emptyPage,
    id: 'page_arts',
    panels: emptyPage.panels.map((panel) => ({
      ...panel,
      artId: `art_${panel.id}`,
      arts: [
        {
          id: `art_${panel.id}`,
          ref: `file:${panel.id}.png`,
          provider: 'fake',
          prompt: '',
          createdAt: '2026-10-16T00:00:00.000Z',
        },
      ],
    })),
  }
  const project: Project = {
    ...fixture,
    episodes: [{ ...episode, pages: [emptyPage, pageWithArts] }],
  }

  const loadAsset = async (ref: string) =>
    new Blob([new Uint8Array(await readFile(new URL(ref.replace(/^file:/, ''), artDir)))])
  const ctx: RenderContext = {
    settings: project.settings,
    characters: project.characters,
    loadAsset,
  }
  const bytes = async (blob: Blob) => Buffer.from(await blob.arrayBuffer())
  const collect = (pageIds: ID[], format: ExportFormat = 'png', load = loadAsset) =>
    collectExportJob(project, episode.id, pageIds, format, opts, load)

  test('collectExportJob bundles only the adopted art of the target pages', async () => {
    const refs: string[] = []
    const job = await collect([pageWithArts.id], 'png', (ref) => {
      refs.push(ref)
      return loadAsset(ref)
    })
    expect(refs.sort()).toEqual(pageWithArts.panels.map((p) => `file:${p.id}.png`).sort())
    expect(Object.keys(job.assets)).toHaveLength(pageWithArts.panels.length)
    expect(await collect([emptyPage.id])).toMatchObject({ assets: {} })
  })

  test('a single png page produces the same bytes as renderPage', async () => {
    for (const page of [emptyPage, pageWithArts]) {
      const expected = await bytes(await renderPage(page, ctx, opts))
      const received = await bytes(await runExportJob(await collect([page.id])))
      expect(received.equals(expected)).toBe(true)
    }
  })

  test('several png pages come out as a zip, reporting progress per page', async () => {
    const progress: [number, number][] = []
    const zip = await runExportJob(await collect([emptyPage.id, pageWithArts.id]), (d, t) =>
      progress.push([d, t]),
    )
    expect(zip.type).toBe('application/zip')
    const text = (await bytes(zip)).toString('latin1')
    expect(text).toContain('p01.png')
    expect(text).toContain('p02.png')
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
  })

  test('pdf jobs go through exportPdf with the bundled assets', async () => {
    const progress: number[] = []
    const pdf = await runExportJob(await collect([emptyPage.id, pageWithArts.id], 'pdf'), (d) =>
      progress.push(d),
    )
    expect(pdf.type).toBe('application/pdf')
    expect(progress).toEqual([1, 2])
  })

  test('the reference image is neither bundled nor drawn', async () => {
    const withReference: Page = {
      ...pageWithArts,
      reference: { ref: 'blob:reference', opacity: 1, visible: true },
    }
    const job = await collectExportJob(
      { ...project, episodes: [{ ...episode, pages: [withReference] }] },
      episode.id,
      [withReference.id],
      'png',
      opts,
      loadAsset,
    )
    expect(Object.keys(job.assets)).toHaveLength(pageWithArts.panels.length)
    const expected = await bytes(await renderPage(pageWithArts, ctx, opts))
    expect((await bytes(await runExportJob(job))).equals(expected)).toBe(true)
  })

  test('runExportJob fails when an art is missing from the job', async () => {
    const job = await collect([pageWithArts.id])
    await expect(runExportJob({ ...job, assets: {} })).rejects.toThrow(/not bundled/)
  })

  test('countMissingArts counts panels without an adopted art', () => {
    expect(countMissingArts([emptyPage, pageWithArts])).toBe(emptyPage.panels.length)
  })
}
