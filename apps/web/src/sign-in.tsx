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
 * サーバ側でセッションが失効してもクライアントはログイン中のままなので、ログイン中でもボタンを出す
 */
export function FailureAlert({ failure, error }: { failure: string; error: unknown }) {
  return (
    <p className={`${common.error} ${common.actions}`} role="alert">
      <span>
        {failure}: {errorMessage(error)}
      </span>
      {needsSignIn(error) && <SignInButton size="small" variant="primary" />}
    </p>
  )
}
