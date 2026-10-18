import { getLocale, m } from '@manga/i18n'
import type { ID } from '@manga/schema'
import { Button, Input, Select, Typography, XStack, YStack } from '@manga/ui'
import { Suspense, startTransition, use, useState } from 'react'
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
  // 読めなければ未ログインと同じ案内を出す
  const load = () => sharing.members(projectId).catch(() => null)
  // Promise を Suspense の外に持つのは、中で作ると読み込みのたびに作り直して終わらないため
  const [members, setMembers] = useState(load)
  const reload = () => {
    const next = load()
    // transition にするのは、操作のたびに fallback に戻して入力中のフォームと招待リンクを消さないため
    startTransition(() => setMembers(next))
    return next
  }
  return (
    <Suspense fallback={<Typography tone="muted">{m.web_sharing_loading_members()}</Typography>}>
      <MembersView members={members} reload={reload} projectId={projectId} sharing={sharing} />
    </Suspense>
  )
}

function MembersView({
  members: membersPromise,
  reload,
  projectId,
  sharing,
}: {
  members: Promise<Members | null>
  reload: () => Promise<unknown>
  projectId: ID
  sharing: SharingClient
}) {
  const members = use(membersPromise)
  const [link, setLink] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

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

  if (members === null) {
    return <Typography tone="muted">{m.web_sharing_sign_in_to_invite()}</Typography>
  }
  const isOwner = members.role === 'owner'

  return (
    <YStack gap={12} className={styles.panel}>
      <Typography>{m.web_sharing_your_role({ role: ROLE_LABELS[members.role] })}</Typography>
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
          <Input label={m.web_sharing_email()} name="email" type="email" required />
          <Select label={m.web_sharing_role()} name="role" defaultValue="editor">
            <RoleOptions />
          </Select>
          <Button type="submit" variant="primary" disabled={busy}>
            {m.web_sharing_create_invite_link()}
          </Button>
        </form>
      )}
      {link && (
        <XStack as="p" wrap className={styles.link}>
          <Input
            label={m.web_sharing_invite_link()}
            hideLabel
            readOnly
            value={link}
            onFocus={(e) => e.target.select()}
          />
          <Button size="small" onClick={() => void navigator.clipboard.writeText(link)}>
            {m.web_common_copy()}
          </Button>
          <Typography as="small" variant="caption" tone="muted">
            {m.web_sharing_invite_link_hint()}
          </Typography>
        </XStack>
      )}
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
      <Typography variant="subheading">{m.web_sharing_members()}</Typography>
      <YStack as="ul" className={styles.list}>
        {members.members.map((member) => (
          <XStack as="li" wrap key={member.userId}>
            <span title={member.userId}>{member.name ?? member.email ?? member.userId}</span>
            {isOwner && member.role !== 'owner' ? (
              <>
                <Select
                  label={m.web_sharing_member_role({ member: member.email ?? member.userId })}
                  hideLabel
                  value={member.role}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() =>
                      sharing.setRole(projectId, member.userId, e.target.value as MemberRole),
                    )
                  }
                >
                  <RoleOptions />
                </Select>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => sharing.removeMember(projectId, member.userId))}
                >
                  {m.web_sharing_remove_member()}
                </Button>
              </>
            ) : (
              <small>{ROLE_LABELS[member.role]}</small>
            )}
          </XStack>
        ))}
      </YStack>
      {isOwner && members.invites.length > 0 && (
        <>
          <Typography variant="subheading">{m.web_sharing_pending_invites()}</Typography>
          <YStack as="ul" className={styles.list}>
            {members.invites.map((invite) => (
              <XStack as="li" wrap key={invite.id}>
                <span>{invite.email}</span>
                <small>
                  {m.web_sharing_pending_invite_detail({
                    role: ROLE_LABELS[invite.role],
                    date: new Date(invite.expiresAt).toLocaleDateString(getLocale()),
                  })}
                </small>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => sharing.revokeInvite(projectId, invite.id))}
                >
                  {m.web_sharing_revoke_invite()}
                </Button>
              </XStack>
            ))}
          </YStack>
        </>
      )}
    </YStack>
  )
}
