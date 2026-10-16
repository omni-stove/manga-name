import type { ID } from '@manga/schema'
import { Button, Input, Select } from '@manga/ui'
import { useCallback, useEffect, useId, useState } from 'react'
import common from './common.module.css'
import { errorMessage } from './route-error'
import { type MemberRole, type Members, ROLE_LABELS, type SharingClient } from './sharing'
import styles from './sharing-panel.module.css'

const MEMBER_ROLES: readonly MemberRole[] = ['editor', 'commenter', 'viewer']

const RoleOptions = () =>
  MEMBER_ROLES.map((role) => (
    <option key={role} value={role}>
      {ROLE_LABELS[role]}
    </option>
  ))

/**
 * プロジェクトの参加者と招待。owner は招待リンクを作って渡し、参加者のロールを変えたり外したりできる。
 * アプリはメールを送らないので、作ったリンクは owner がコピーして招待先に渡す
 */
export function SharingPanel({ projectId, sharing }: { projectId: ID; sharing: SharingClient }) {
  const id = useId()
  const [members, setMembers] = useState<Members | null | undefined>()
  const [link, setLink] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const reload = useCallback(
    () =>
      sharing.members(projectId).then(setMembers, (e: unknown) => {
        setMembers(null)
        setError(errorMessage(e))
      }),
    [sharing, projectId],
  )
  useEffect(() => void reload(), [reload])

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await task()
      await reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (members === undefined) return <p className={common.placeholder}>参加者を読み込み中…</p>
  if (members === null) {
    return (
      <p className={common.placeholder}>
        ログインしてクラウドに保存されると、ほかの人を招待できます。
      </p>
    )
  }
  const isOwner = members.role === 'owner'

  return (
    <div className={styles.panel}>
      <p>あなたのロール: {ROLE_LABELS[members.role]}</p>
      {isOwner && (
        <form
          className={styles.invite}
          onSubmit={(e) => {
            e.preventDefault()
            const form = e.currentTarget
            const data = new FormData(form)
            const email = String(data.get('email') ?? '').trim()
            const role = String(data.get('role')) as MemberRole
            void run(async () => {
              const created = await sharing.invite(projectId, email, role)
              setLink(created.url)
              form.reset()
            })
          }}
        >
          <label htmlFor={`${id}-email`}>メールアドレス</label>
          <Input id={`${id}-email`} name="email" type="email" required />
          <label htmlFor={`${id}-role`}>ロール</label>
          <Select id={`${id}-role`} name="role" defaultValue="editor">
            <RoleOptions />
          </Select>
          <Button type="submit" variant="primary" disabled={busy}>
            招待リンクを作る
          </Button>
        </form>
      )}
      {link && (
        <p className={styles.link}>
          <Input readOnly value={link} aria-label="招待リンク" onFocus={(e) => e.target.select()} />
          <Button size="small" onClick={() => void navigator.clipboard.writeText(link)}>
            コピー
          </Button>
          <small className={common.placeholder}>
            このリンクを招待先に渡してください。招待したメールアドレスでログインした人だけが参加できます。
          </small>
        </p>
      )}
      {error && (
        <p className={common.error} role="alert">
          {error}
        </p>
      )}
      <h3>参加者</h3>
      <ul className={styles.list}>
        {members.members.map((m) => (
          <li key={m.userId}>
            <span title={m.userId}>{m.name ?? m.email ?? m.userId}</span>
            {isOwner && m.role !== 'owner' ? (
              <>
                <Select
                  aria-label={`${m.email ?? m.userId} のロール`}
                  value={m.role}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() =>
                      sharing.setRole(projectId, m.userId, e.target.value as MemberRole),
                    )
                  }
                >
                  <RoleOptions />
                </Select>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => sharing.removeMember(projectId, m.userId))}
                >
                  外す
                </Button>
              </>
            ) : (
              <small>{ROLE_LABELS[m.role]}</small>
            )}
          </li>
        ))}
      </ul>
      {isOwner && members.invites.length > 0 && (
        <>
          <h3>未使用の招待</h3>
          <ul className={styles.list}>
            {members.invites.map((invite) => (
              <li key={invite.id}>
                <span>{invite.email}</span>
                <small>
                  {ROLE_LABELS[invite.role]}・{new Date(invite.expiresAt).toLocaleDateString()} まで
                </small>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => sharing.revokeInvite(projectId, invite.id))}
                >
                  取り消す
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
