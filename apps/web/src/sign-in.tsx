import { SignInRequiredError } from '@manga/ai'
import { Button, type ButtonProps } from '@manga/ui'
import common from './common.module.css'
import { errorMessage } from './route-error'
import { signInOrNotify } from './toasts'
import { useAuth } from './use-auth'

/** 未ログインのせいで失敗したか */
export const needsSignIn = (error: unknown): boolean => error instanceof SignInRequiredError

/** 押すとログインを始める。始められなければトーストで知らせる */
export function SignInButton(props: Omit<ButtonProps, 'onClick' | 'children'>) {
  const { signIn } = useAuth()
  return (
    <Button {...props} onClick={() => signInOrNotify(signIn)}>
      ログイン
    </Button>
  )
}

/**
 * 「<failure>: <理由>」のエラー表示。未ログインのせいなら、その場でログインできるボタンを添える。
 * サーバ側でセッションが失効してもクライアントはログイン中のままなので、ログイン中でもボタンを出す。
 * ログインはページごと遷移するので、未保存の入力がある画面は `signInButton={false}` でボタンを省く
 */
export function FailureAlert({
  failure,
  error,
  signInButton = true,
}: {
  failure: string
  error: unknown
  signInButton?: boolean
}) {
  return (
    <p className={`${common.error} ${common.actions}`} role="alert">
      <span>
        {failure}: {errorMessage(error)}
      </span>
      {signInButton && needsSignIn(error) && <SignInButton size="small" variant="primary" />}
    </p>
  )
}
