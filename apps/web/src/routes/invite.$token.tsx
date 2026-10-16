import { Button } from '@manga/ui'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import common from '../common.module.css'
import { errorMessage } from '../route-error'
import { type InvitePreview, ROLE_LABELS } from '../sharing'
import { toasts } from '../toasts'
import { useAuth } from '../use-auth'

export const Route = createFileRoute('/invite/$token')({ component: AcceptInvite })

/**
 * 招待リンクの受け口。ログインしていなければログインさせ、招待先のメールアドレスでログインしていれば参加させて
 * そのプロジェクトを開く。違うメールアドレスなら参加させず、ログインし直すよう促す
 */
function AcceptInvite() {
  const { token } = Route.useParams()
  const { sharing } = Route.useRouteContext()
  const { user, signIn, signOut } = useAuth()
  const navigate = useNavigate()
  const [invite, setInvite] = useState<InvitePreview | null>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user === null) return
    setError(undefined)
    sharing.previewInvite(token).then(setInvite, (e: unknown) => setError(errorMessage(e)))
  }, [sharing, token, user])

  if (user === null) {
    return (
      <section>
        <h1>プロジェクトへの招待</h1>
        <p>
          招待を受け取るには、招待されたメールアドレスの Google アカウントでログインしてください。
        </p>
        <Button
          variant="primary"
          onClick={() =>
            signIn().catch((e: unknown) => toasts.push(`ログインできません: ${String(e)}`))
          }
        >
          ログイン
        </Button>
      </section>
    )
  }
  if (error) {
    return (
      <section>
        <h1>プロジェクトへの招待</h1>
        <p className={common.error} role="alert">
          {error}
        </p>
      </section>
    )
  }
  if (invite === undefined) return <p className={common.placeholder}>招待を確かめています…</p>
  if (invite === null) {
    return (
      <section>
        <h1>プロジェクトへの招待</h1>
        <p>招待が見つからないか、期限が切れています。招待した人に新しいリンクを頼んでください。</p>
        <Link to="/">プロジェクト一覧へ</Link>
      </section>
    )
  }
  const matches = user.email.trim().toLowerCase() === invite.email
  return (
    <section>
      <h1>「{invite.projectTitle || '無題'}」への招待</h1>
      <p>
        {invite.email} を{ROLE_LABELS[invite.role]}として招待しています（
        {new Date(invite.expiresAt).toLocaleDateString()} まで）。
      </p>
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
          <p className={common.error}>
            いまは {user.email} でログインしています。{invite.email}{' '}
            でログインし直すと受け取れます。
          </p>
          <Button onClick={() => void signOut()}>サインアウト</Button>
        </>
      )}
    </section>
  )
}
