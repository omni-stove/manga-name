import { SignInRequiredError } from '@manga/ai'
import { m } from '@manga/i18n'
import { ApiError, HttpError } from '@manga/schema'
import { Button, Typography, XStack, YStack } from '@manga/ui'
import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router'
import { apiErrorMessage } from './api-error-message'

/** loader の失敗（ストレージが開けない、保存内容がスキーマを通らない等）を出す。ルーターの既定のエラー画面 */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <YStack as="section" gap={16} align="start" role="alert">
      <Typography variant="title">{m.web_route_error_title()}</Typography>
      <Typography tone="alert">{errorMessage(error)}</Typography>
      <XStack as="p" wrap>
        <Button onClick={() => void router.invalidate()}>{m.retry()}</Button>
        <Link to="/">{m.web_back_to_project_list()}</Link>
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
 * 画面に出すエラー文。workers/api の ApiError は code に対応する文言に、SignInRequiredError はログインを促す文言に、
 * 本文が ApiErrorBody でない HttpError は状態コードを添えた文言にする。
 * ZodError は JSON の塊を message に持つので、issue ごとに「パス: 理由」の行にする。
 * zod に依存しないよう `issues` の有無で見分ける
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return apiErrorMessage(error)
  if (error instanceof SignInRequiredError) return m.web_sign_in_required()
  if (error instanceof HttpError) return m.web_http_error({ status: error.status })
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
    expect(errorMessage(new HttpError(502, '<h1>Bad Gateway</h1>', 'GET'))).toBe(
      m.web_http_error({ status: 502 }),
    )
    expect(errorMessage(new ApiError(403, { code: 'owner_only' }, 'PUT member'))).toBe(
      m.api_error_owner_only(),
    )
  })
}
