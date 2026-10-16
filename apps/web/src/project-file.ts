import { type Project, parseProject } from '@manga/schema'

/** プロジェクトを JSON テキストにする。アセットは ref のまま書き、中身は含めない */
export function exportProjectJson(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`
}

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

/** ブラウザでテキストをファイルとしてダウンロードさせる */
export function downloadText(fileName: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  // click 直後に revoke するとダウンロードが始まらないブラウザがある
  setTimeout(() => URL.revokeObjectURL(url), 0)
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
