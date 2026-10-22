import { z } from 'zod'
import { PatchSchema } from './patch'
import {
  BubbleSchema,
  CameraSchema,
  CharacterSchema,
  IdSchema,
  PageSchema,
  PanelActingSchema,
  ProjectBaseSchema,
} from './project'

const blob = z.instanceof(Blob)

export const PanelArtRequestSchema = z.object({
  project: ProjectBaseSchema.pick({ settings: true, characters: true }),
  page: PageSchema,
  panelId: IdSchema,
  layoutPng: blob,
  hint: z.string().optional(),
  /** コマが属するシーンの見出し（sceneOf）。前のページに遡って引くので、page だけからは決まらない */
  scene: z.string().optional(),
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
  /** コマごとのシーンの見出し（pageScenes）。キーは Panel.id */
  scenes: z.record(IdSchema, z.string()).optional(),
  /** Page.reference をページ丸ごと */
  referencePng: blob.optional(),
  characterRefs: z.array(z.object({ characterId: IdSchema, image: blob })).optional(),
})

/** キャラの参照画像を外見から作る要求 */
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
  /** このページに当たる脚本の原文。Page.script になる */
  script: z.string().min(1),
  /** このページに出るキャラ（Character.id）。Page.cast になる */
  cast: z.array(IdSchema),
  /** このページのセリフ。読む順 */
  lines: z.array(PlanLineSchema),
})

/** ページ割りの応答。読む順のページごとの割り振り */
export const PagePlanResponseSchema = z.array(PagePlanSchema).min(1)

/** LLM に返させるページ割り。構造化出力は根を object に限るので、ページの配列を `pages` で包む */
export const PagePlanReplySchema = z.object({ pages: PagePlanResponseSchema })

/** ネームの書き起こしで 1 ページに置けるコマの数の上限 */
export const MAX_NAME_PANELS = 12

/** ネームの書き起こしの 1 コマ。コマ割りの提案で枠を得て Panel になる */
export const NamePanelSchema = z.object({
  /** このコマで描くもの。Panel.note になる */
  note: z.string().min(1),
  /** Panel.camera になる */
  camera: CameraSchema.optional(),
  /** このコマのセリフ。読む順。Bubble になる */
  lines: z.array(PlanLineSchema),
  /** 登場キャラの芝居。Panel.acting になる */
  acting: z.array(PanelActingSchema.extend({ text: z.string().min(1) })).optional(),
})

/** ネームの書き起こしの応答。1 ページの脚本を読む順のコマに割ったもの */
export const NameDraftResponseSchema = z.object({
  panels: z.array(NamePanelSchema).min(1).max(MAX_NAME_PANELS),
})

/** 直している途中のネーム。描くものとセリフは入力の途中で空になるので、空も通す */
export const NameDraftSchema = z.array(
  NamePanelSchema.extend({
    note: z.string(),
    lines: z.array(PlanLineSchema.extend({ text: z.string() })),
    acting: z.array(PanelActingSchema).optional(),
  }),
)

/** コマ割りの提案の 1 コマ。ネームの同じ位置のコマに枠を与える */
export const SuggestedPanelSchema = z.object({
  /** 行の中での幅の比。行のコマの width の和で割って幅にする */
  width: z.number().positive(),
})

/** コマ割りの提案の 1 段。コマは読む順 */
export const SuggestedRowSchema = z.object({
  /** ページの中での高さの比。全段の height の和で割って高さにする */
  height: z.number().positive(),
  panels: z.array(SuggestedPanelSchema).min(1).max(4),
})

/** ページのコマ割りの案 1 つ。段は上から、全段のコマを読む順に並べるとネームのコマと 1 対 1 に対応する */
export const LayoutOptionSchema = z.object({
  /** 案の狙い */
  summary: z.string().min(1),
  rows: z.array(SuggestedRowSchema).min(1).max(6),
})

/** コマ割りの提案の応答。違う狙いの案を並べる */
export const LayoutSuggestionResponseSchema = z.object({
  options: z.array(LayoutOptionSchema).min(1).max(3),
})

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
export type NamePanel = z.infer<typeof NamePanelSchema>
export type NameDraftResponse = z.infer<typeof NameDraftResponseSchema>
export type SuggestedPanel = z.infer<typeof SuggestedPanelSchema>
export type SuggestedRow = z.infer<typeof SuggestedRowSchema>
export type LayoutOption = z.infer<typeof LayoutOptionSchema>
export type LayoutSuggestionResponse = z.infer<typeof LayoutSuggestionResponseSchema>
export type CritiqueResponse = z.infer<typeof CritiqueResponseSchema>

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('PagePlanResponseSchema needs at least one page with a non-empty note, script and lines', () => {
    const plan = { note: 'n', script: 's', cast: [], lines: [{ text: 't', shape: 'normal' }] }
    expect(PagePlanResponseSchema.parse([plan])).toHaveLength(1)
    expect(PagePlanResponseSchema.safeParse([]).success).toBe(false)
    expect(PagePlanResponseSchema.safeParse([{ ...plan, note: '' }]).success).toBe(false)
    expect(PagePlanResponseSchema.safeParse([{ ...plan, script: '' }]).success).toBe(false)
    expect(
      PagePlanResponseSchema.safeParse([{ ...plan, lines: [{ text: '', shape: 'normal' }] }])
        .success,
    ).toBe(false)
  })

  test('NameDraftResponseSchema needs 1 to MAX_NAME_PANELS panels with a non-empty note', () => {
    const panel = { note: 'n', lines: [{ text: 't', shape: 'normal' }] }
    expect(NameDraftResponseSchema.parse({ panels: [panel] }).panels).toHaveLength(1)
    const invalid = [
      { panels: [] },
      { panels: Array.from({ length: MAX_NAME_PANELS + 1 }, () => panel) },
      { panels: [{ ...panel, note: '' }] },
      { panels: [{ ...panel, camera: '' }] },
      { panels: [{ ...panel, acting: [{ characterId: 'chr_e', text: '' }] }] },
    ]
    for (const res of invalid) expect(NameDraftResponseSchema.safeParse(res).success).toBe(false)
    const acting = [{ characterId: 'chr_e', text: '振り向く' }]
    expect(
      NameDraftResponseSchema.parse({ panels: [{ ...panel, acting }] }).panels[0]?.acting,
    ).toEqual(acting)
    expect(
      NameDraftSchema.parse([
        {
          note: '',
          lines: [{ text: '', shape: 'normal' }],
          acting: [{ characterId: 'chr_e', text: '' }],
        },
      ]),
    ).toHaveLength(1)
  })

  test('LayoutSuggestionResponseSchema needs positive ratios and 1 to 3 options of 1 to 6 rows', () => {
    const panel = { width: 1 }
    const option = { summary: 's', rows: [{ height: 1, panels: [panel] }] }
    expect(LayoutSuggestionResponseSchema.parse({ options: [option] }).options).toHaveLength(1)
    const invalid = [
      { options: [] },
      { options: [option, option, option, option] },
      { options: [{ ...option, rows: [] }] },
      { options: [{ ...option, rows: [{ height: 0, panels: [panel] }] }] },
      { options: [{ ...option, rows: [{ height: 1, panels: [{ ...panel, width: -1 }] }] }] },
      { options: [{ ...option, rows: [{ height: 1, panels: [] }] }] },
    ]
    for (const res of invalid)
      expect(LayoutSuggestionResponseSchema.safeParse(res).success).toBe(false)
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
        },
        characters: [],
      },
      page: { id: 'pg', panels: [], scribbles: [] },
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
        },
        characters: [],
      },
      page: { id: 'pg', panels: [], scribbles: [] },
      layoutPng: new Blob(),
    }
    expect(PageArtRequestSchema.parse({ ...base, hints: { pn: 'h' } }).hints).toEqual({ pn: 'h' })
    expect(PageArtRequestSchema.safeParse({ ...base, hints: { pn: 1 } }).success).toBe(false)
    expect(PageArtRequestSchema.parse({ ...base, scenes: { pn: 's' } }).scenes).toEqual({ pn: 's' })
    expect(PageArtRequestSchema.parse({ ...base, previous: {} })).not.toHaveProperty('previous')
  })
}
