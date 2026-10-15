import { z } from 'zod'

/** JSON Patch（RFC 6902）のうち store と AI 提案が使う 3 操作 */
export const PatchSchema = z.array(
  z.object({
    op: z.enum(['add', 'remove', 'replace']),
    path: z.string(),
    value: z.unknown().optional(),
  }),
)

export type Patch = z.infer<typeof PatchSchema>

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('PatchSchema accepts add / remove / replace and rejects other ops', () => {
    const patch: Patch = [
      { op: 'add', path: '/episodes/0/pages/-', value: {} },
      { op: 'remove', path: '/episodes/0/pages/0' },
      { op: 'replace', path: '/title', value: 't' },
    ]
    expect(PatchSchema.parse(patch)).toEqual(patch)
    expect(PatchSchema.safeParse([{ op: 'move', path: '/a', from: '/b' }]).success).toBe(false)
  })
}
