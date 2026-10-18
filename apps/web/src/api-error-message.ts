import { getLocale, m } from '@manga/i18n'
import type { ApiError, ApiErrorBody, ApiErrorCode } from '@manga/schema'

type Messages = {
  [C in ApiErrorCode]: (body: Extract<ApiErrorBody, { code: C }>) => string
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)}MB`

// Record にしているのは、API_ERRORS に code を足して文言を書き忘れたら型エラーにするため
const MESSAGES: Messages = {
  unauthorized: () => m.api_error_unauthorized(),
  rate_limited: () => m.api_error_rate_limited(),
  generation_limit_reached: ({ params }) =>
    m.api_error_generation_limit_reached({
      limit: params.limit,
      resetsAt: new Date(params.resetsAt).toLocaleDateString(getLocale()),
    }),
  invalid_request: () => m.api_error_invalid_request(),
  if_match_required: () => m.api_error_if_match_required(),
  websocket_required: () => m.api_error_websocket_required(),
  body_too_large: () => m.api_error_body_too_large(),
  project_too_large: ({ params }) =>
    m.api_error_project_too_large({ max: megabytes(params.maxBytes) }),
  asset_too_large: ({ params }) => m.api_error_asset_too_large({ max: megabytes(params.maxBytes) }),
  not_found: () => m.api_error_not_found(),
  edit_forbidden: () => m.api_error_edit_forbidden(),
  commenter_scribbles_only: () => m.api_error_commenter_scribbles_only(),
  owner_only: () => m.api_error_owner_only(),
  invite_email_mismatch: () => m.api_error_invite_email_mismatch(),
  invalid_upload_url: () => m.api_error_invalid_upload_url(),
  upload_url_expired: () => m.api_error_upload_url_expired(),
  country_blocked: () => m.api_error_country_blocked(),
  conflict: () => m.api_error_conflict(),
  asset_already_uploaded: () => m.api_error_asset_already_uploaded(),
  asset_uploads_unavailable: () => m.api_error_asset_uploads_unavailable(),
  provider_invalid_response: () => m.api_error_provider_invalid_response(),
  internal_error: () => m.api_error_internal_error(),
}

/** workers/api のエラーを、code に対応する画面向けの文言にする */
export function apiErrorMessage(error: ApiError): string {
  const { body } = error
  return (MESSAGES[body.code] as (body: ApiErrorBody) => string)(body)
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { ApiError } = await import('@manga/schema')

  test('a code becomes its message, with params filled in', () => {
    expect(apiErrorMessage(new ApiError(404, { code: 'not_found' }, 'GET'))).toBe(
      '見つかりません。削除されたか、参加していない可能性があります',
    )
    expect(
      apiErrorMessage(
        new ApiError(413, { code: 'project_too_large', params: { maxBytes: 5 * 1024 * 1024 } }, ''),
      ),
    ).toBe('プロジェクトが 5MB を超えたため、クラウドに保存できません')
    expect(
      apiErrorMessage(
        new ApiError(
          402,
          {
            code: 'generation_limit_reached',
            params: { limit: 100, resetsAt: '2026-11-01T12:00:00.000Z' },
          },
          '',
        ),
      ),
    ).toMatch(/^今月の生成回数の上限（100 回）に達しました。2026\/11\/1 から/)
  })
}
