import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router'

/** loader の失敗（ストレージが開けない、保存内容がスキーマを通らない等）を出す。ルーターの既定のエラー画面 */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <section role="alert">
      <h1>読み込めませんでした</h1>
      <p className="error">{errorMessage(error)}</p>
      <p className="actions">
        <button type="button" onClick={() => void router.invalidate()}>
          再試行
        </button>
        <Link to="/">プロジェクト一覧へ</Link>
      </p>
    </section>
  )
}

interface IssueLike {
  path: PropertyKey[]
  message: string
}

const hasIssues = (error: unknown): error is { issues: IssueLike[] } =>
  typeof error === 'object' && error !== null && 'issues' in error && Array.isArray(error.issues)

/**
 * 画面に出すエラー文。ZodError は JSON の塊を message に持つので、issue ごとに「パス: 理由」の行にする。
 * zod に依存しないよう `issues` の有無で見分ける
 */
export function errorMessage(error: unknown): string {
  if (hasIssues(error)) {
    return error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
  }
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { ProjectSchema, createEmptyProject } = await import('@manga/schema')

  test('errorMessage lists schema issues by path', () => {
    const result = ProjectSchema.safeParse({ ...createEmptyProject('t'), title: 1 })
    expect(result.success).toBe(false)
    expect(errorMessage(result.error)).toMatch(/^title: /)
    expect(errorMessage(new Error('x'))).toBe('x')
    expect(errorMessage('y')).toBe('y')
  })
}
