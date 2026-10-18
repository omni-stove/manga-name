import { z } from 'zod'
import { PatchSchema } from './patch'
import { BubbleSchema, CharacterSchema, IdSchema, PageSchema, ProjectBaseSchema } from './project'

const blob = z.instanceof(Blob)

export const PanelArtRequestSchema = z.object({
  project: ProjectBaseSchema.pick({ settings: true, characters: true }),
  page: PageSchema,
  panelId: IdSchema,
  layoutPng: blob,
  hint: z.string().optional(),
  referencePng: blob.optional(),
  characterRefs: z.array(z.object({ characterId: IdSchema, image: blob })).optional(),
  previous: z.object({ art: blob, instruction: z.string() }).optional(),
})

/**
 * ページ 1 枚分の絵を 1 回で作る要求。返った絵は Web が各コマの rect で切り抜いて PanelArt にする。
 * 修正指示つきの再生成はコマ単位（PanelArtRequest）でだけ受ける
 */
export const PageArtRequestSchema = z.object({
  project: ProjectBaseSchema.pick({ settings: true, characters: true }),
  page: PageSchema,
  /** render.renderPageLayoutPng の出力 */
  layoutPng: blob,
  /** コマごとの診断のヒント。キーは Panel.id */
  hints: z.record(IdSchema, z.string()).optional(),
  /** Page.reference をページ丸ごと */
  referencePng: blob.optional(),
  characterRefs: z.array(z.object({ characterId: IdSchema, image: blob })).optional(),
})

/** キャラの参照画像を外見から作る要求。画風は settings.style から取る */
export const CharacterArtRequestSchema = z.object({
  project: ProjectBaseSchema.pick({ settings: true }),
  character: CharacterSchema,
})

/** ページ割りで 1 ページに割り振った脚本のセリフ 1 つ。Bubble になる */
export const PlanLineSchema = z.object({
  /** 話すキャラ（Character.id）。ナレーションと話し手の分からないセリフでは省く */
  speakerId: IdSchema.optional(),
  /** 脚本のセリフそのまま */
  text: z.string().min(1),
  shape: BubbleSchema.shape.shape,
})

/** 「脚本から下書き」の前段で作る 1 ページ分の割り振り */
export const PagePlanSchema = z.object({
  /** このページで起きること。Page.note になる */
  note: z.string().min(1),
  /** このページに出るキャラ（Character.id）。Page.cast になる */
  cast: z.array(IdSchema),
  /** このページのセリフ。読む順 */
  lines: z.array(PlanLineSchema),
})

/** ページ割りの応答。読む順のページごとの割り振り */
export const PagePlanResponseSchema = z.array(PagePlanSchema).min(1)

export const CritiqueResponseSchema = z.object({
  summary: z.string(),
  suggestions: z.array(z.object({ message: z.string(), patch: PatchSchema })),
})

export type PanelArtRequest = z.infer<typeof PanelArtRequestSchema>
export type PageArtRequest = z.infer<typeof PageArtRequestSchema>
export type CharacterArtRequest = z.infer<typeof CharacterArtRequestSchema>
export type PlanLine = z.infer<typeof PlanLineSchema>
export type PagePlan = z.infer<typeof PagePlanSchema>
export type PagePlanResponse = z.infer<typeof PagePlanResponseSchema>
export type CritiqueResponse = z.infer<typeof CritiqueResponseSchema>

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('PagePlanResponseSchema needs at least one page with a non-empty note and non-empty lines', () => {
    const plan = { note: 'n', cast: [], lines: [{ text: 't', shape: 'normal' }] }
    expect(PagePlanResponseSchema.parse([plan])).toHaveLength(1)
    expect(PagePlanResponseSchema.safeParse([]).success).toBe(false)
    expect(PagePlanResponseSchema.safeParse([{ ...plan, note: '' }]).success).toBe(false)
    expect(
      PagePlanResponseSchema.safeParse([{ ...plan, lines: [{ text: '', shape: 'normal' }] }])
        .success,
    ).toBe(false)
  })

  test('CritiqueResponseSchema requires a Patch per suggestion', () => {
    const ok = {
      summary: 's',
      suggestions: [{ message: 'm', patch: [{ op: 'remove', path: '/x' }] }],
    }
    expect(CritiqueResponseSchema.parse(ok)).toEqual(ok)
    expect(
      CritiqueResponseSchema.safeParse({ summary: 's', suggestions: [{ message: 'm' }] }).success,
    ).toBe(false)
  })

  test('PanelArtRequestSchema requires layoutPng to be a Blob', () => {
    const base = {
      project: {
        settings: {
          direction: 'rtl',
          pageSize: { w: 182, h: 257, unit: 'mm' },
          dpi: 300,
          style: { prompt: 'p' },
        },
        characters: [],
      },
      page: { id: 'pg', side: 'single', panels: [], scribbles: [] },
      panelId: 'pn',
    }
    expect(PanelArtRequestSchema.safeParse({ ...base, layoutPng: new Blob() }).success).toBe(true)
    expect(PanelArtRequestSchema.safeParse({ ...base, layoutPng: 'png' }).success).toBe(false)
  })

  test('PageArtRequestSchema takes hints keyed by panel id and no previous art', () => {
    const base = {
      project: {
        settings: {
          direction: 'rtl',
          pageSize: { w: 182, h: 257, unit: 'mm' },
          dpi: 300,
          style: { prompt: 'p' },
        },
        characters: [],
      },
      page: { id: 'pg', side: 'single', panels: [], scribbles: [] },
      layoutPng: new Blob(),
    }
    expect(PageArtRequestSchema.parse({ ...base, hints: { pn: 'h' } }).hints).toEqual({ pn: 'h' })
    expect(PageArtRequestSchema.safeParse({ ...base, hints: { pn: 1 } }).success).toBe(false)
    expect(PageArtRequestSchema.parse({ ...base, previous: {} })).not.toHaveProperty('previous')
  })
}
