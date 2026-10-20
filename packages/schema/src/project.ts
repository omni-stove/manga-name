import { z } from 'zod'

export const SCHEMA_VERSION = 24 as const

export const IdSchema = z.string().min(1)
export const IsoDateSchema = z.iso.datetime()

/** 0..1 の正規化座標。ページ座標もコマ内座標も同じ範囲 */
const unit = z.number().min(0).max(1)

export const PointSchema = z.object({ x: unit, y: unit })
export const SizeSchema = z.object({ w: unit, h: unit })
export const RectSchema = z.object({ x: unit, y: unit, w: unit, h: unit })

export const ReadingDirectionSchema = z.enum(['rtl', 'ltr'])

export const DiagnosisConfigSchema = z.object({
  pathBand: z.number().min(0),
  requireStrongForOk: z.boolean(),
})

export const ProjectSettingsSchema = z.object({
  direction: ReadingDirectionSchema,
  pageSize: z.object({
    w: z.number().positive(),
    h: z.number().positive(),
    unit: z.literal('mm'),
  }),
  dpi: z.number().int().positive(),
  diagnosis: DiagnosisConfigSchema.partial().optional(),
  /** 全キャラに共通する絵柄や頭身。キャラごとの外見（Character.appearance）と一緒に生成に渡す */
  characterDesign: z.string().optional(),
})

export const CharacterSchema = z.object({
  id: IdSchema,
  name: z.string(),
  shortName: z.string(),
  appearance: z.string().optional(),
  referenceRef: z.string().optional(),
  note: z.string().optional(),
})

const order = z.number().int().min(1)

/**
 * セリフの書体。gothic はゴシック、bold は太ゴシック、mincho は明朝、rounded は丸ゴシック、hand は手書き風。
 * 画面には messages/schema の `bubble_typeface_<値>` で出す
 */
export const BubbleTypefaceSchema = z.enum(['gothic', 'bold', 'mincho', 'rounded', 'hand'])

export const BubbleSchema = z.object({
  id: IdSchema,
  order,
  speakerId: IdSchema.optional(),
  text: z.string(),
  shape: z.enum([
    'normal',
    'shout',
    'thought',
    'whisper',
    'tremble',
    'electronic',
    'urchin',
    'narration',
    'monologue',
    'none',
  ]),
  pos: PointSchema,
  size: SizeSchema,
  /** しっぽの先端。1 本ずつ描く。最後の要素を最後に触ったしっぽとして「しっぽを消す」が消す */
  tails: z.array(PointSchema).optional(),
  /** 省略は形に合わせる（bubbleTypeface） */
  typeface: BubbleTypefaceSchema.optional(),
  /** フキダシの地の色。黒は体としっぽを黒で塗り、セリフを白で描く。地を持たない形（none）では無視する。省略は白 */
  fill: z.enum(['black']).optional(),
  overflow: z.boolean().optional(),
  locked: z.boolean().optional(),
})

export const PanelArtSchema = z.object({
  id: IdSchema,
  ref: z.string(),
  provider: z.string(),
  prompt: z.string(),
  instruction: z.string().optional(),
  parentId: IdSchema.optional(),
  createdAt: IsoDateSchema,
})

export const SweepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('centre'), y: unit }),
  z.object({ kind: z.literal('polyline'), points: z.array(PointSchema) }),
])

export const FocusKindSchema = z.enum(['face', 'keyObject', 'sfx'])

/**
 * コマの中で目を引く点。pos はコマ内座標、weight は目の引き具合。
 * sfx の label は描き文字として紙面に描く（sfxLetterings）。face と keyObject は紙面に描かない
 */
export const FocusPointSchema = z.object({
  id: IdSchema,
  kind: FocusKindSchema,
  label: z.string(),
  pos: PointSchema,
  weight: unit,
  characterId: IdSchema.optional(),
  locked: z.boolean().optional(),
})

/**
 * コマの枠線。none は枠線を引かず、他のコマを上に重ねる下敷きの大ゴマにもなる。
 * round（角丸）、wavy（波線）、soft（ぼかし）は回想・夢、cloud（雲形）は空想や夢想、dashed（破線）、double（二重線）は過去や画面の中に使う。
 * soft は枠線を引かず、絵の縁を紙の地の色へぼかす。画面には messages/schema の `panel_frame_<値>` で出す
 */
export const PanelFrameSchema = z.enum([
  'none',
  'round',
  'wavy',
  'dashed',
  'double',
  'soft',
  'cloud',
])
/**
 * コマに描く効果線。focus_lines（集中線）は焦点へ向かう放射状の線、speed_lines（スピード線）は動きの向きに平行な線。
 * 画面には messages/schema の `panel_effect_<値>` で出す
 */
export const PanelEffectSchema = z.enum(['focus_lines', 'speed_lines'])
/** コマの絵に掛ける色調。sepia は茶色、faded は色を抜いて薄くし、回想に使う。画面には `page_tone_<値>` で出す */
export const PageToneSchema = z.enum(['sepia', 'faded'])
/** コマの絵に掛ける色調。none はページに色調があってもそのコマには掛けない。画面には `panel_tone_<値>` で出す */
export const PanelToneSchema = z.enum([...PageToneSchema.options, 'none'])

export const VectorKindSchema = z.enum(['gaze', 'motion', 'speed'])
/** コマの画面の切り取り方。画面には messages/schema の `panel_camera_<値>` で出す */
export const CameraSchema = z.enum([
  'long',
  'middle',
  'bust',
  'close_up',
  'low_angle',
  'high_angle',
])
export const StrengthSchema = z.enum(['strong', 'weak'])

export const VectorSchema = z.object({
  id: IdSchema,
  kind: VectorKindSchema,
  from: PointSchema,
  to: PointSchema,
  strength: StrengthSchema,
  sourceFocusId: IdSchema.optional(),
  targetFocusId: IdSchema.optional(),
  locked: z.boolean().optional(),
})

export const ReferenceImageSchema = z.object({
  ref: z.string(),
  opacity: unit,
  visible: z.boolean(),
})

export const StrokeSchema = z.object({
  id: IdSchema,
  points: z.array(PointSchema),
  width: z.number().positive(),
  color: z.enum(['ink', 'red', 'blue']),
})

/** コマの中のキャラの芝居（表情・動き）。例「振り向いて驚く」 */
export const PanelActingSchema = z.object({
  characterId: IdSchema,
  text: z.string(),
})

type RefineCtx = z.RefinementCtx
type Path = (string | number)[]

const addIssue = (ctx: RefineCtx, path: Path, message: string) =>
  ctx.addIssue({ code: 'custom', path, message })

const checkUniqueOrder = (ctx: RefineCtx, items: { order: number }[], path: Path) => {
  const seen = new Set<number>()
  items.forEach((item, i) => {
    if (seen.has(item.order))
      addIssue(ctx, [...path, i, 'order'], `order ${item.order} is duplicated`)
    seen.add(item.order)
  })
}

// Panel の参照整合は Panel 単体で閉じるのでここで検証する。characters への参照だけは Project が持つ
const PanelBaseSchema = z.object({
  id: IdSchema,
  order,
  rect: RectSchema,
  shape: z.array(PointSchema).min(3).optional(),
  /** コマの地の色。黒は暗転や無音の間に使う。絵があれば絵が上に乗る */
  fill: z.enum(['black']).optional(),
  /** 枠線。省略は実線の枠 */
  frame: PanelFrameSchema.optional(),
  /** 絵の上、フキダシと枠線の下に描く効果線。省略は描かない */
  effect: PanelEffectSchema.optional(),
  /** 絵に掛ける色調。ページの tone を上書きし、ページの一部のコマだけを回想にする。省略はページの tone に従う */
  tone: PanelToneSchema.optional(),
  bubbles: z.array(BubbleSchema),
  note: z.string().optional(),
  camera: CameraSchema.optional(),
  arts: z.array(PanelArtSchema),
  artId: IdSchema.optional(),
  focusPoints: z.array(FocusPointSchema),
  vectors: z.array(VectorSchema),
  sweep: SweepSchema.optional(),
  cast: z.array(IdSchema).optional(),
  /** 登場キャラごとの芝居。空の芝居は要素ごと持たない */
  acting: z.array(PanelActingSchema).optional(),
  locked: z.boolean().optional(),
})

export const PanelSchema = PanelBaseSchema.superRefine((panel, ctx) => {
  const artIds = new Set(panel.arts.map((a) => a.id))
  if (panel.artId !== undefined && !artIds.has(panel.artId)) {
    addIssue(ctx, ['artId'], `artId ${panel.artId} is not in arts`)
  }
  panel.arts.forEach((art, i) => {
    if (art.parentId !== undefined && !artIds.has(art.parentId)) {
      addIssue(ctx, ['arts', i, 'parentId'], `parentId ${art.parentId} is not in arts`)
    }
  })

  const focusIds = new Set([
    ...panel.focusPoints.map((f) => f.id),
    ...panel.bubbles.map((b) => b.id),
  ])
  panel.vectors.forEach((v, i) => {
    for (const key of ['sourceFocusId', 'targetFocusId'] as const) {
      const id = v[key]
      if (id !== undefined && !focusIds.has(id)) {
        addIssue(
          ctx,
          ['vectors', i, key],
          `${key} ${id} is not a FocusPoint or Bubble of this panel`,
        )
      }
    }
  })

  checkUniqueOrder(ctx, panel.bubbles, ['bubbles'])
})

const PageBaseSchema = z.object({
  id: IdSchema,
  /**
   * 見開きのページ。正規化座標は 2 ページ分（幅 2 倍）の紙面に対してとり、ノンブルは 2 つ使う。
   * 左右のページに分けないのは、ノドをまたぐコマを 1 つのコマのまま持つため
   */
  spread: z.literal(true).optional(),
  /** 紙の地の色。黒は間白とタチキリの外を黒ベタにし、回想のページに使う。省略は白 */
  ground: z.enum(['black']).optional(),
  /** コマの絵に掛ける色調。フキダシと枠には掛けない。省略は生成したままの色 */
  tone: PageToneSchema.optional(),
  /** 紙面全体に重ねるトーン。gray はフキダシと間白も含めて灰色を乗算で重ね、回想のページに使う。省略は重ねない */
  overlay: z.enum(['gray']).optional(),
  panels: z.array(PanelSchema),
  reference: ReferenceImageSchema.optional(),
  scribbles: z.array(StrokeSchema),
  /** 原作者の下描き。コメント用の scribbles と分け、コマとフキダシへの変換元にする */
  sketch: z.array(StrokeSchema).optional(),
  note: z.string().optional(),
  /** このページに当たる脚本の原文（ト書きとセリフ）。`note` は作業のメモで、脚本とは分けて持つ */
  script: z.string().optional(),
  cast: z.array(IdSchema).optional(),
})

export const PageSchema = PageBaseSchema.superRefine((page, ctx) => {
  checkUniqueOrder(ctx, page.panels, ['panels'])
})

/** 登録したコマ割り。コマの枠だけを持ち、絵やフキダシは持たない */
const LayoutTemplateBaseSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  panels: z.array(PanelBaseSchema.pick({ order: true, rect: true, shape: true })),
})

export const LayoutTemplateSchema = LayoutTemplateBaseSchema.superRefine((template, ctx) => {
  checkUniqueOrder(ctx, template.panels, ['panels'])
})

export const EpisodeSchema = z.object({
  id: IdSchema,
  title: z.string(),
  /** 1 ページ目を右ページにする。既定は左ページ。掲載誌の台割で決まるので話ごとに持つ */
  startsRight: z.literal(true).optional(),
  pages: z.array(PageSchema),
})

export const ProjectBaseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: IdSchema,
  title: z.string(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  settings: ProjectSettingsSchema,
  characters: z.array(CharacterSchema),
  episodes: z.array(EpisodeSchema),
  layoutTemplates: z.array(LayoutTemplateSchema).optional(),
})

export const ProjectSchema = ProjectBaseSchema.superRefine((project, ctx) => {
  const characterIds = new Set(project.characters.map((c) => c.id))
  project.episodes.forEach((episode, ei) => {
    episode.pages.forEach((page, pi) => {
      page.cast?.forEach((id, ci) => {
        if (!characterIds.has(id)) {
          addIssue(
            ctx,
            ['episodes', ei, 'pages', pi, 'cast', ci],
            `cast ${id} is not in characters`,
          )
        }
      })
      page.panels.forEach((panel, ni) => {
        const base: Path = ['episodes', ei, 'pages', pi, 'panels', ni]
        panel.bubbles.forEach((b, bi) => {
          if (b.speakerId !== undefined && !characterIds.has(b.speakerId)) {
            addIssue(
              ctx,
              [...base, 'bubbles', bi, 'speakerId'],
              `speakerId ${b.speakerId} is not in characters`,
            )
          }
        })
        panel.focusPoints.forEach((f, fi) => {
          if (f.characterId !== undefined && !characterIds.has(f.characterId)) {
            addIssue(
              ctx,
              [...base, 'focusPoints', fi, 'characterId'],
              `characterId ${f.characterId} is not in characters`,
            )
          }
        })
        panel.cast?.forEach((id, ci) => {
          if (!characterIds.has(id)) {
            addIssue(ctx, [...base, 'cast', ci], `cast ${id} is not in characters`)
          }
        })
        panel.acting?.forEach((a, ai) => {
          if (!characterIds.has(a.characterId)) {
            addIssue(
              ctx,
              [...base, 'acting', ai, 'characterId'],
              `characterId ${a.characterId} is not in characters`,
            )
          }
        })
      })
    })
  })
})

export type ID = z.infer<typeof IdSchema>
export type ISODate = z.infer<typeof IsoDateSchema>
export type Point = z.infer<typeof PointSchema>
export type Size = z.infer<typeof SizeSchema>
export type Rect = z.infer<typeof RectSchema>
export type ReadingDirection = z.infer<typeof ReadingDirectionSchema>
export type DiagnosisConfig = z.infer<typeof DiagnosisConfigSchema>
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>
export type Character = z.infer<typeof CharacterSchema>
export type Bubble = z.infer<typeof BubbleSchema>
export type PanelArt = z.infer<typeof PanelArtSchema>
export type Sweep = z.infer<typeof SweepSchema>
export type FocusKind = z.infer<typeof FocusKindSchema>
export type FocusPoint = z.infer<typeof FocusPointSchema>
export type VectorKind = z.infer<typeof VectorKindSchema>
export type Camera = z.infer<typeof CameraSchema>
export type Strength = z.infer<typeof StrengthSchema>
export type Vector = z.infer<typeof VectorSchema>
export type ReferenceImage = z.infer<typeof ReferenceImageSchema>
export type Stroke = z.infer<typeof StrokeSchema>
export type PanelActing = z.infer<typeof PanelActingSchema>
export type Panel = z.infer<typeof PanelSchema>
export type Page = z.infer<typeof PageSchema>
export type LayoutTemplate = z.infer<typeof LayoutTemplateSchema>
export type Episode = z.infer<typeof EpisodeSchema>
export type Project = z.infer<typeof ProjectSchema>

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest

  const loadFixture = async (): Promise<Project> => {
    const { default: fixture } = await import('../../../fixtures/sample-page-01.json')
    return ProjectSchema.parse(fixture.project)
  }

  const panel = (project: Project, index: number): Panel => {
    const p = project.episodes[0]?.pages[0]?.panels[index]
    if (!p) throw new Error(`fixture has no panel ${index}`)
    return p
  }

  const issuePaths = (project: Project): string[] => {
    const result = ProjectSchema.safeParse(project)
    expect(result.success).toBe(false)
    return result.success ? [] : result.error.issues.map((i) => i.path.join('.'))
  }

  const panelPath = (index: number, rest: string) => `episodes.0.pages.0.panels.${index}.${rest}`

  test('fixtures/sample-page-01.json passes ProjectSchema.parse', async () => {
    const project = await loadFixture()
    expect(project.episodes[0]?.pages[0]?.panels).toHaveLength(6)
  })

  describe('reference integrity', () => {
    test('artId must be in arts', async () => {
      const project = await loadFixture()
      panel(project, 0).artId = 'art_missing'
      expect(issuePaths(project)).toContain(panelPath(0, 'artId'))
    })

    test('PanelArt.parentId must be in the same panel arts', async () => {
      const project = await loadFixture()
      panel(project, 0).arts.push({
        id: 'art_1',
        ref: 'blob:1',
        provider: 'fake',
        prompt: 'p',
        parentId: 'art_missing',
        createdAt: '2026-10-15T00:00:00.000Z',
      })
      expect(issuePaths(project)).toContain(panelPath(0, 'arts.0.parentId'))
    })

    test('Vector focus references must be a FocusPoint or Bubble of the panel', async () => {
      const project = await loadFixture()
      const vector = panel(project, 0).vectors[0]
      if (!vector) throw new Error('fixture panel 1 has no vector')
      vector.targetFocusId = 'fp_missing'
      expect(issuePaths(project)).toContain(panelPath(0, 'vectors.0.targetFocusId'))
    })

    test('Bubble.speakerId, FocusPoint.characterId, Panel.cast, Panel.acting and Page.cast must be in characters', async () => {
      const project = await loadFixture()
      const bubble = panel(project, 5).bubbles[0]
      const focus = panel(project, 0).focusPoints[1]
      if (!bubble || !focus) throw new Error('fixture is missing the expected bubble or focus')
      bubble.speakerId = 'chr_missing'
      focus.characterId = 'chr_missing'
      panel(project, 2).cast = ['chr_missing']
      panel(project, 3).acting = [
        { characterId: 'chr_e', text: '振り向く' },
        { characterId: 'chr_missing', text: '驚く' },
      ]
      const page = project.episodes[0]?.pages[0]
      if (!page) throw new Error('fixture has no page')
      page.cast = ['chr_e', 'chr_missing']
      const paths = issuePaths(project)
      expect(paths).toContain(panelPath(5, 'bubbles.0.speakerId'))
      expect(paths).toContain(panelPath(0, 'focusPoints.1.characterId'))
      expect(paths).toContain(panelPath(2, 'cast.0'))
      expect(paths).toContain(panelPath(3, 'acting.1.characterId'))
      expect(paths).not.toContain(panelPath(3, 'acting.0.characterId'))
      expect(paths).toContain('episodes.0.pages.0.cast.1')
      expect(paths).not.toContain('episodes.0.pages.0.cast.0')
    })

    test('Panel.order and Bubble.order must be unique', async () => {
      const project = await loadFixture()
      panel(project, 1).order = 1
      expect(issuePaths(project)).toContain('episodes.0.pages.0.panels.1.order')

      const other = await loadFixture()
      const target = panel(other, 0)
      const first = target.bubbles[0]
      if (!first) throw new Error('fixture panel 1 has no bubble')
      target.bubbles.push({ ...first, id: 'bb_dup' })
      expect(issuePaths(other)).toContain(panelPath(0, 'bubbles.1.order'))
    })

    test('LayoutTemplate needs a name and unique panel orders', async () => {
      const project = await loadFixture()
      const rect = { x: 0, y: 0, w: 1, h: 0.5 }
      project.layoutTemplates = [
        {
          id: 'lt_1',
          name: '',
          panels: [
            { order: 1, rect },
            { order: 1, rect },
          ],
        },
      ]
      const paths = issuePaths(project)
      expect(paths).toContain('layoutTemplates.0.name')
      expect(paths).toContain('layoutTemplates.0.panels.1.order')
    })

    test('Point, Size and Rect are 0..1', async () => {
      const project = await loadFixture()
      const bubble = panel(project, 0).bubbles[0]
      if (!bubble) throw new Error('fixture panel 1 has no bubble')
      bubble.pos.x = 1.2
      panel(project, 1).rect.w = -0.1
      panel(project, 1).bubbles.push({
        ...bubble,
        id: 'bb_big',
        pos: { x: 0.5, y: 0.5 },
        size: { w: 1.5, h: 0.2 },
      })
      const paths = issuePaths(project)
      expect(paths).toContain(panelPath(0, 'bubbles.0.pos.x'))
      expect(paths).toContain(panelPath(1, 'rect.w'))
      expect(paths).toContain(panelPath(1, 'bubbles.0.size.w'))
    })
  })
}
