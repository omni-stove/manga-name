import sample from '../../../fixtures/sample-page-01.json'
import { parseProject } from './parse'

/** `fixtures/sample-page-01.json`。読み込み時に検証済み */
export const fixtures = { samplePage01: parseProject(sample.project) }

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('samplePage01 has one page of six panels', () => {
    expect(fixtures.samplePage01.episodes[0]?.pages[0]?.panels).toHaveLength(6)
  })
}
