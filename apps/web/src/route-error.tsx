import { ApiError } from '@manga/schema'
import { Button, Typography, XStack, YStack } from '@manga/ui'
import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router'
import { apiErrorMessage } from './api-error-message'

/** loader の失敗（ストレージが開けない、保存内容がスキーマを通らない等）を出す。ルーターの既定のエラー画面 */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <YStack as="section" gap={16} align="start" role="alert">
      <Typography variant="title">読み込めませんでした</Typography>
      <Typography tone="alert">{errorMessage(error)}</Typography>
      <XStack as="p" wrap>
        <Button onClick={() => void router.invalidate()}>再試行</Button>
        <Link to="/">プロジェクト一覧へ</Link>
      </XStack>
    </YStack>
  )
}

interface IssueLike {
  path: PropertyKey[]
  message: string
}

const hasIssues = (error: unknown): error is { issues: IssueLike[] } =>
  typeof error === 'object' && error !== null && 'issues' in error && Array.isArray(error.issues)

/**
 * 画面に出すエラー文。workers/api の ApiError は code に対応する文言にする。
 * ZodError は JSON の塊を message に持つので、issue ごとに「パス: 理由」の行にする。
 * zod に依存しないよう `issues` の有無で見分ける
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return apiErrorMessage(error)
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
    expect(errorMessage(new ApiError(403, { code: 'owner_only' }, 'PUT member'))).toBe(
      '参加者の管理はオーナーだけができます',
    )
  })
}
