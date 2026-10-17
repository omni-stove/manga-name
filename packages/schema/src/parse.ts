import { migrate } from './migrate'
import { type Project, ProjectSchema } from './project'

/**
 * 保存された JSON をマイグレーションしてから検証し、Project を返す。
 * 不正なら ZodError（形式）または Error（版）を throw する。
 */
export function parseProject(json: unknown): Project {
  return ProjectSchema.parse(migrate(json))
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('parseProject accepts the sample fixture', async () => {
    const { default: fixture } = await import('../../../fixtures/sample-page-01.json')
    expect(parseProject(fixture.project).id).toBe('prj_sample')
  })

  test('parseProject rejects invalid JSON', () => {
    expect(() => parseProject({ schemaVersion: 1 })).toThrow()
    expect(() => parseProject('x')).toThrow()
  })
}
