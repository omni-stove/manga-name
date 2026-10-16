import { type RenderContext, type RenderOptions, renderPage } from '@manga/render'
import { type Character, currentArt, type Page, type ProjectSettings } from '@manga/schema'

/**
 * Worker に渡す 1 ページ分の入力。関数は postMessage を越えられないので、
 * `renderPage` が読む採用中の絵をメインスレッドで先に読み、ref をキーにして同梱する
 */
export interface ExportJob {
  page: Page
  settings: ProjectSettings
  characters: Character[]
  opts: RenderOptions
  assets: Record<string, Blob>
}

export interface ExportRequest {
  id: number
  job: ExportJob
}

export type ExportReply =
  | { id: number; ok: true; png: Blob }
  | { id: number; ok: false; message: string }

/** `renderPage` が読むアセットを集めて ExportJob にする */
export async function collectExportJob(
  page: Page,
  ctx: RenderContext,
  opts: RenderOptions,
): Promise<ExportJob> {
  const refs = [...new Set(page.panels.flatMap((panel) => currentArt(panel)?.ref ?? []))]
  const loaded = await Promise.all(
    refs.map(async (ref) => [ref, await ctx.loadAsset(ref)] as const),
  )
  return {
    page,
    settings: ctx.settings,
    characters: ctx.characters,
    opts,
    assets: Object.fromEntries(loaded),
  }
}

/** ExportJob から PNG を作る。Worker の中で呼ぶが、同梱したアセットしか読まないのでメインスレッドでも同じバイト列になる */
export function runExportJob(job: ExportJob): Promise<Blob> {
  const ctx: RenderContext = {
    settings: job.settings,
    characters: job.characters,
    async loadAsset(ref) {
      const blob = job.assets[ref]
      if (!blob) throw new Error(`asset ${ref} was not bundled into the export job`)
      return blob
    },
  }
  return renderPage(job.page, ctx, job.opts)
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const { readFile } = await import('node:fs/promises')

  const project = fixtures.samplePage01
  const emptyPage = project.episodes[0]?.pages[0]
  if (!emptyPage) throw new Error('fixture にページがない')
  const artDir = new URL('../../../docs/fixtures/art/', import.meta.url)
  const opts: RenderOptions = { width: 364, notes: 'margin', panelNumbers: true }

  const pageWithArts: Page = {
    ...emptyPage,
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

  const ctx: RenderContext = {
    settings: project.settings,
    characters: project.characters,
    loadAsset: async (ref) =>
      new Blob([new Uint8Array(await readFile(new URL(ref.replace(/^file:/, ''), artDir)))]),
  }

  const bytes = async (blob: Blob) => Buffer.from(await blob.arrayBuffer())

  test('collectExportJob bundles only the adopted art of each panel', async () => {
    const refs: string[] = []
    const job = await collectExportJob(
      pageWithArts,
      {
        ...ctx,
        loadAsset(ref) {
          refs.push(ref)
          return ctx.loadAsset(ref)
        },
      },
      opts,
    )
    expect(refs.sort()).toEqual(pageWithArts.panels.map((p) => `file:${p.id}.png`).sort())
    expect(Object.keys(job.assets)).toHaveLength(pageWithArts.panels.length)
    expect(await collectExportJob(emptyPage, ctx, opts)).toMatchObject({ assets: {} })
  })

  test('runExportJob produces the same bytes as renderPage on the same page', async () => {
    for (const page of [emptyPage, pageWithArts]) {
      const expected = await bytes(await renderPage(page, ctx, opts))
      const received = await bytes(await runExportJob(await collectExportJob(page, ctx, opts)))
      expect(received.equals(expected)).toBe(true)
    }
  })

  test('the reference image is neither bundled nor drawn', async () => {
    const page: Page = {
      ...pageWithArts,
      reference: { ref: 'blob:reference', opacity: 1, visible: true },
    }
    const job = await collectExportJob(page, ctx, opts)
    expect(Object.keys(job.assets)).toHaveLength(pageWithArts.panels.length)
    const expected = await bytes(await renderPage(pageWithArts, ctx, opts))
    expect((await bytes(await runExportJob(job))).equals(expected)).toBe(true)
  })

  test('runExportJob fails when an art is missing from the job', async () => {
    const job = await collectExportJob(pageWithArts, ctx, opts)
    await expect(runExportJob({ ...job, assets: {} })).rejects.toThrow(/not bundled/)
  })
}
