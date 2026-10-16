import { type Project, parseProject } from '@manga/schema'

/** プロジェクトを JSON テキストにする。アセットは ref のまま書き、中身は含めない */
export function exportProjectJson(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`
}

/** ダイアログでプロジェクトの JSON を選ばせる絞り込み。拡張子は最後の `.json` しか指定できない */
export const PROJECT_FILE_FILTERS = [{ name: 'マンガネーム', extensions: ['json'] }]

/** 書き出しのファイル名。ファイル名に使えない文字は `_` にする */
export function exportFileName(project: Project): string {
  const base = project.title.trim().replaceAll(/[\\/:*?"<>|\p{Cc}]/gu, '_') || project.id
  return `${base}.manga.json`
}

/**
 * JSON テキストを読んでプロジェクトにする。
 * `exportProjectJson` の出力と、`{ "project": ... }` で包んだ docs/fixtures の形式の両方を受け付ける。
 * JSON でない、またはスキーマを通らないときは throw する。
 */
export function parseProjectFile(text: string): Project {
  return parseProject(unwrap(parseJson(text)))
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error('JSON として読めません', { cause: error })
  }
}

function unwrap(json: unknown): unknown {
  if (typeof json !== 'object' || json === null || 'schemaVersion' in json) return json
  return 'project' in json ? json.project : json
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures, createEmptyProject } = await import('@manga/schema')

  test('export passes parseProject and round-trips', () => {
    const json = exportProjectJson(fixtures.samplePage01)
    expect(parseProject(JSON.parse(json))).toEqual(fixtures.samplePage01)
    expect(parseProjectFile(json)).toEqual(fixtures.samplePage01)
  })

  test('the fixture file in docs/fixtures can be imported', async () => {
    const { default: text } = await import('../../../docs/fixtures/sample-page-01.json?raw')
    const project = parseProjectFile(text)
    expect(project.id).toBe('prj_sample')
    expect(project.episodes[0]?.pages[0]?.panels).toHaveLength(6)
  })

  test('rejects text that is not JSON or not a project', () => {
    expect(() => parseProjectFile('{')).toThrow('JSON として読めません')
    expect(() => parseProjectFile('{"project": {"schemaVersion": 1}}')).toThrow()
    expect(() => parseProjectFile('[]')).toThrow()
  })

  test('exportFileName replaces characters that are not allowed in file names', () => {
    const project = createEmptyProject('a/b:c')
    expect(exportFileName(project)).toBe('a_b_c.manga.json')
    expect(exportFileName({ ...project, title: ' ' })).toBe(`${project.id}.manga.json`)
  })
}
