import { DISPLAY_NAME_MAX_LENGTH, DisplayNameSchema } from '@manga/schema'
import { Button, Dialog, Input, Typography, XStack } from '@manga/ui'
import { useState } from 'react'
import { errorMessage } from './route-error'
import { useAuth } from './use-auth'

const HINT = '同じプロジェクトのメンバーに見える名前です。Google アカウントの名前は使いません'

/** 表示名の入力と保存。保存できたら true を返す */
function useDisplayNameInput(initial: string) {
  const { setName } = useAuth()
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const parsed = DisplayNameSchema.safeParse(value)
    if (!parsed.success) {
      setError(`1〜${DISPLAY_NAME_MAX_LENGTH} 文字で入力してください`)
      return false
    }
    setBusy(true)
    setError(undefined)
    try {
      await setName(parsed.data)
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  const input = (
    <Input
      label="表示名"
      value={value}
      maxLength={DISPLAY_NAME_MAX_LENGTH}
      required
      autoComplete="nickname"
      hint={HINT}
      error={error}
      onChange={(e) => setValue(e.target.value)}
    />
  )
  return { input, busy, save }
}

/**
 * 登録した直後の、表示名がまだ無いユーザーに表示名を決めさせるモーダル。
 * 「あとで」で閉じても、次に開いたときにまた出る。決めるまでの間、参加者一覧にはメールアドレスが出る
 */
export function DisplayNameDialog() {
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState(false)
  if (user === null || user.name !== '' || dismissed) return null
  return <DisplayNameDialogBody onClose={() => setDismissed(true)} />
}

function DisplayNameDialogBody({ onClose }: { onClose(): void }) {
  const { input, busy, save } = useDisplayNameInput('')
  return (
    <Dialog
      title="表示名を決める"
      onClose={onClose}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            あとで
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            決める
          </Button>
        </>
      }
    >
      <Typography>ペンネームなど、本名でなくてもかまいません。</Typography>
      {input}
    </Dialog>
  )
}

/** アプリ設定に置く、表示名を変えるフォーム */
export function DisplayNameForm({ name }: { name: string }) {
  const { input, busy, save } = useDisplayNameInput(name)
  const [saved, setSaved] = useState(false)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setSaved(false)
        void save().then(setSaved)
      }}
    >
      <XStack wrap align="end">
        {input}
        <Button type="submit" size="small" disabled={busy}>
          保存
        </Button>
        {saved && (
          <Typography as="span" tone="muted" role="status">
            保存しました
          </Typography>
        )}
      </XStack>
    </form>
  )
}
