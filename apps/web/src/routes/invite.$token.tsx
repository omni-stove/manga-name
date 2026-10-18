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
 * そのプロジェクトを開く。違うメールアドレスなら参加させず、ログインし直すよう促す
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
        <Typography variant="title">プロジェクトへの招待</Typography>
        <Typography>
          招待を受け取るには、招待されたメールアドレスの Google アカウントでログインしてください。
        </Typography>
        <SignInButton variant="primary" inviteToken={token} />
      </YStack>
    )
  }
  if (error) {
    return (
      <YStack as="section" gap={16} align="start">
        <Typography variant="title">プロジェクトへの招待</Typography>
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      </YStack>
    )
  }
  if (invite === undefined) return <Typography tone="muted">招待を確かめています…</Typography>
  if (invite === null) {
    return (
      <YStack as="section" gap={16} align="start">
        <Typography variant="title">プロジェクトへの招待</Typography>
        <Typography>
          招待が見つからないか、期限が切れています。招待した人に新しいリンクを頼んでください。
        </Typography>
        <Link to="/">プロジェクト一覧へ</Link>
      </YStack>
    )
  }
  const matches = user.email.trim().toLowerCase() === invite.email
  return (
    <YStack as="section" gap={16} align="start">
      <Typography variant="title">「{invite.projectTitle || '無題'}」への招待</Typography>
      <Typography>
        {invite.email} を{ROLE_LABELS[invite.role]}として招待しています（
        {new Date(invite.expiresAt).toLocaleDateString()} まで）。
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
          参加する
        </Button>
      ) : (
        <>
          <Typography tone="alert">
            いまは {user.email} でログインしています。{invite.email}{' '}
            でログインし直すと受け取れます。
          </Typography>
          <Button onClick={() => void signOut()}>サインアウト</Button>
        </>
      )}
    </YStack>
  )
}
