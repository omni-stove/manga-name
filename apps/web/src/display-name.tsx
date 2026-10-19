import { m } from '@manga/i18n'
import { DISPLAY_NAME_MAX_LENGTH, DisplayNameSchema } from '@manga/schema'
import { Button, Dialog, Input, Typography, XStack } from '@manga/ui'
import { useState } from 'react'
import { errorMessage } from './route-error'
import { useAuth } from './use-auth'

/** 表示名の入力と保存。保存できたら true を返す */
function useDisplayNameInput(initial: string) {
  const { setName } = useAuth()
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const parsed = DisplayNameSchema.safeParse(value)
    if (!parsed.success) {
      setError(m.web_display_name_length_error({ max: DISPLAY_NAME_MAX_LENGTH }))
      return false
    }
    setBusy(true)
    setError(undefined)
    let saved = true
    try {
      await setName(parsed.data)
    } catch (e) {
      setError(errorMessage(e))
      saved = false
    }
    setBusy(false)
    return saved
  }
  const input = (
    <Input
      label={m.web_display_name_label()}
      value={value}
      maxLength={DISPLAY_NAME_MAX_LENGTH}
      required
      autoComplete="nickname"
      hint={m.web_display_name_hint()}
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
      title={m.web_display_name_dialog_title()}
      onClose={onClose}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {m.web_display_name_later()}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {m.web_display_name_decide()}
          </Button>
        </>
      }
    >
      <Typography>{m.web_display_name_dialog_body()}</Typography>
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
          {m.save()}
        </Button>
        {saved && (
          <Typography as="span" tone="muted" role="status">
            {m.saved()}
          </Typography>
        )}
      </XStack>
    </form>
  )
}
