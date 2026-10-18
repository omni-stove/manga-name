import { getLocale, m } from '@manga/i18n'
import { Button, Typography, YStack } from '@manga/ui'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { errorMessage } from '../route-error'
import { ROLE_LABELS } from '../sharing'
import { SignInButton } from '../sign-in'
import { useAuth } from '../use-auth'

export const Route = createFileRoute('/invite/$token')({
  // 招待を見るにはログインが要る。ログインとサインアウトで main がルーターを invalidate するので読み直される
  loader: ({ context, params }) =>
    context.auth.getUser() === null ? undefined : context.sharing.previewInvite(params.token),
  component: AcceptInvite,
})

/**
 * 招待リンクの受け口。ログインしていなければログインさせ、招待先のメールアドレスでログインしていれば参加させて
 * そのプロジェクトを開く。違うメールアドレスなら参加させず、ログインし直すよう促す。
 * メールアドレスの無い招待なら、誰がログインしていても参加させる
 */
function AcceptInvite() {
  const { token } = Route.useParams()
  const { sharing } = Route.useRouteContext()
  const invite = Route.useLoaderData()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  if (user === null) {
    return (
      <YStack as="section" gap={16} align="start">
        <Typography variant="title">{m.web_invite_title()}</Typography>
        <Typography>{m.web_invite_sign_in_prompt()}</Typography>
        <SignInButton variant="primary" inviteToken={token} />
      </YStack>
    )
  }
  if (error) {
    return (
      <YStack as="section" gap={16} align="start">
        <Typography variant="title">{m.web_invite_title()}</Typography>
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      </YStack>
    )
  }
  if (invite === undefined) return <Typography tone="muted">{m.web_invite_checking()}</Typography>
  if (invite === null) {
    return (
      <YStack as="section" gap={16} align="start">
        <Typography variant="title">{m.web_invite_title()}</Typography>
        <Typography>{m.web_invite_not_found()}</Typography>
        <Link to="/">{m.web_invite_back_to_projects()}</Link>
      </YStack>
    )
  }
  const date = new Date(invite.expiresAt).toLocaleDateString(getLocale())
  const role = ROLE_LABELS[invite.role]
  const invited = invite.email
  const matches = invited === null || user.email.trim().toLowerCase() === invited
  return (
    <YStack as="section" gap={16} align="start">
      <Typography variant="title">
        {m.web_invite_project_title({ title: invite.projectTitle || m.web_common_untitled() })}
      </Typography>
      <Typography>
        {invited === null
          ? m.web_invite_open_detail({ role, date })
          : m.web_invite_detail({ email: invited, role, date })}
      </Typography>
      {matches ? (
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            sharing
              .acceptInvite(token)
              .then((projectId) => navigate({ to: '/p/$projectId', params: { projectId } }))
              .catch((e: unknown) => setError(errorMessage(e)))
              .finally(() => setBusy(false))
          }}
        >
          {m.web_invite_join()}
        </Button>
      ) : (
        <>
          <Typography tone="alert">
            {m.web_invite_wrong_account({ current: user.email, invited })}
          </Typography>
          <Button onClick={() => void signOut()}>{m.web_sign_out()}</Button>
        </>
      )}
    </YStack>
  )
}
