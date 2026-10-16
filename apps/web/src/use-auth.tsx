import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react'
import { type AuthClient, type AuthUser, createAuthClient } from './auth'

// Provider の外（ルーターのテストなど）では API の無いクライアントで常に未ログインになる
const AuthContext = createContext<AuthClient>(createAuthClient({ baseUrl: '' }))

/** 子孫の useAuth が client を使うようにする */
export function AuthProvider({ client, children }: { client: AuthClient; children: ReactNode }) {
  return <AuthContext.Provider value={client}>{children}</AuthContext.Provider>
}

/** ログイン状態と操作。user が null の間はローカルモードで動く */
export function useAuth(): {
  user: AuthUser | null
  signIn(): Promise<void>
  signOut(): Promise<void>
  getToken(): Promise<string | null>
} {
  const client = useContext(AuthContext)
  const user = useSyncExternalStore(client.subscribe, client.getUser, () => null)
  return { user, signIn: client.signIn, signOut: client.signOut, getToken: client.getToken }
}
