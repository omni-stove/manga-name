import { z } from 'zod'

export const SCHEMA_VERSION = 4 as const

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
  style: z.object({
    prompt: z.string(),
    negative: z.string().optional(),
  }),
  diagnosis: DiagnosisConfigSchema.partial().optional(),
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

export const BubbleSchema = z.object({
  id: IdSchema,
  order,
  speakerId: IdSchema.optional(),
  text: z.string(),
  shape: z.enum(['normal', 'shout', 'thought', 'narration']),
  pos: PointSchema,
  size: SizeSchema,
  tail: PointSchema.optional(),
  overflow: z.boolean().optional(),
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

export const FocusPointSchema = z.object({
  id: IdSchema,
  kind: FocusKindSchema,
  label: z.string(),
  pos: PointSchema,
  weight: unit,
  characterId: IdSchema.optional(),
})

export const VectorKindSchema = z.enum(['gaze', 'motion', 'speed'])
export const StrengthSchema = z.enum(['strong', 'weak'])

export const VectorSchema = z.object({
  id: IdSchema,
  kind: VectorKindSchema,
  from: PointSchema,
  to: PointSchema,
  strength: StrengthSchema,
  sourceFocusId: IdSchema.optional(),
  targetFocusId: IdSchema.optional(),
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
  bubbles: z.array(BubbleSchema),
  note: z.string().optional(),
  camera: z.string().optional(),
  arts: z.array(PanelArtSchema),
  artId: IdSchema.optional(),
  focusPoints: z.array(FocusPointSchema),
  vectors: z.array(VectorSchema),
  sweep: SweepSchema.optional(),
  cast: z.array(IdSchema).optional(),
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
  side: z.enum(['left', 'right', 'single']),
  panels: z.array(PanelSchema),
  reference: ReferenceImageSchema.optional(),
  scribbles: z.array(StrokeSchema),
  note: z.string().optional(),
  cast: z.array(IdSchema).optional(),
})

export const PageSchema = PageBaseSchema.superRefine((page, ctx) => {
  checkUniqueOrder(ctx, page.panels, ['panels'])
})

export const EpisodeSchema = z.object({
  id: IdSchema,
  title: z.string(),
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
export type Strength = z.infer<typeof StrengthSchema>
export type Vector = z.infer<typeof VectorSchema>
export type ReferenceImage = z.infer<typeof ReferenceImageSchema>
export type Stroke = z.infer<typeof StrokeSchema>
export type Panel = z.infer<typeof PanelSchema>
export type Page = z.infer<typeof PageSchema>
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

    test('Bubble.speakerId, FocusPoint.characterId, Panel.cast and Page.cast must be in characters', async () => {
      const project = await loadFixture()
      const bubble = panel(project, 5).bubbles[0]
      const focus = panel(project, 0).focusPoints[1]
      if (!bubble || !focus) throw new Error('fixture is missing the expected bubble or focus')
      bubble.speakerId = 'chr_missing'
      focus.characterId = 'chr_missing'
      panel(project, 2).cast = ['chr_missing']
      const page = project.episodes[0]?.pages[0]
      if (!page) throw new Error('fixture has no page')
      page.cast = ['chr_e', 'chr_missing']
      const paths = issuePaths(project)
      expect(paths).toContain(panelPath(5, 'bubbles.0.speakerId'))
      expect(paths).toContain(panelPath(0, 'focusPoints.1.characterId'))
      expect(paths).toContain(panelPath(2, 'cast.0'))
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
