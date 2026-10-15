import { z } from 'zod'
import { PatchSchema } from './patch'
import { IdSchema, PageSchema, ProjectBaseSchema } from './project'

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

export const LayoutProposalResponseSchema = z.object({
  pages: z.array(PageSchema),
  rationale: z.string(),
})

export const CritiqueResponseSchema = z.object({
  summary: z.string(),
  suggestions: z.array(z.object({ message: z.string(), patch: PatchSchema })),
})

export type PanelArtRequest = z.infer<typeof PanelArtRequestSchema>
export type LayoutProposalResponse = z.infer<typeof LayoutProposalResponseSchema>
export type CritiqueResponse = z.infer<typeof CritiqueResponseSchema>

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('LayoutProposalResponseSchema validates pages with the Page rules', () => {
    const page = { id: 'pg', side: 'single', panels: [], scribbles: [] }
    expect(
      LayoutProposalResponseSchema.parse({ pages: [page], rationale: 'r' }).pages,
    ).toHaveLength(1)
    const bad = { ...page, panels: [{ ...page, order: 1 }] }
    expect(LayoutProposalResponseSchema.safeParse({ pages: [bad], rationale: 'r' }).success).toBe(
      false,
    )
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
}
