import { z } from 'zod'
import { FocusKindSchema, IdSchema, PointSchema } from './project'

export const FocusStatusSchema = z.enum(['ok', 'weak', 'miss'])

export const FocusDiagnosisSchema = z.object({
  focusPointId: IdSchema,
  kind: z.union([FocusKindSchema, z.literal('bubble')]),
  panelId: IdSchema,
  t: z.number(),
  distance: z.number(),
  strong: z.number().int().min(0),
  weak: z.number().int().min(0),
  status: FocusStatusSchema,
  reason: z.string().optional(),
})

export const PanelDiagnosisSchema = z.object({
  panelId: IdSchema,
  sweepPath: z.array(PointSchema),
  focus: z.array(FocusDiagnosisSchema),
  bubbleOrderOk: z.boolean(),
  hint: z.string(),
})

export const IssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  code: z.enum([
    'READING_ORDER',
    'BUBBLE_ORDER',
    'FOCUS_MISS',
    'FOCUS_WEAK',
    'EMPTY_PANEL',
    'OVERLAP',
  ]),
  panelId: IdSchema.optional(),
  focusPointId: IdSchema.optional(),
  message: z.string(),
})

export const PageDiagnosisSchema = z.object({
  pageId: IdSchema,
  readingOrderOk: z.boolean(),
  inferredOrder: z.array(IdSchema),
  panels: z.array(PanelDiagnosisSchema),
  bubbleChain: z.array(PointSchema),
  summary: z.object({
    total: z.number().int().min(0),
    ok: z.number().int().min(0),
    weak: z.number().int().min(0),
    miss: z.number().int().min(0),
  }),
  issues: z.array(IssueSchema),
})

export type FocusStatus = z.infer<typeof FocusStatusSchema>
export type FocusDiagnosis = z.infer<typeof FocusDiagnosisSchema>
export type PanelDiagnosis = z.infer<typeof PanelDiagnosisSchema>
export type Issue = z.infer<typeof IssueSchema>
export type PageDiagnosis = z.infer<typeof PageDiagnosisSchema>

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('PageDiagnosisSchema accepts an empty page diagnosis', () => {
    const diagnosis: PageDiagnosis = {
      pageId: 'pg_1',
      readingOrderOk: true,
      inferredOrder: [],
      panels: [],
      bubbleChain: [],
      summary: { total: 0, ok: 0, weak: 0, miss: 0 },
      issues: [{ severity: 'warning', code: 'EMPTY_PANEL', panelId: 'pn_1', message: 'empty' }],
    }
    expect(PageDiagnosisSchema.parse(diagnosis)).toEqual(diagnosis)
  })

  test('IssueSchema rejects an unknown code', () => {
    expect(IssueSchema.safeParse({ severity: 'info', code: 'NOPE', message: '' }).success).toBe(
      false,
    )
  })
}
