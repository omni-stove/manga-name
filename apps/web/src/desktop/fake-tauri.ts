/** テストで受け取る IPC の 1 回分。`options.headers` は plugin-fs の書き込みがパスを載せる所 */
type FakeInvoke = (
  cmd: string,
  args: unknown,
  options?: { headers?: Record<string, string> },
) => unknown

/**
 * テスト用に、`@tauri-apps/api` が IPC に使う `window.__TAURI_INTERNALS__` を差し替える。
 * `@tauri-apps/api/mocks` の mockIPC を使わないのは、invoke の第 3 引数（plugin-fs が書き込み先のパスを載せる headers）を捨てるため。
 * `window` を `globalThis` にするので、呼び出し側は `vi.unstubAllGlobals()` で戻す。
 * ウィンドウと WebView のラベルは `main`。`callback` は IPC の引数に載った番号から、`listen` などに渡した関数を引く
 */
export function installFakeTauri(
  stubGlobal: (name: string, value: unknown) => unknown,
  invoke: FakeInvoke,
): { callback(id: number): ((response: unknown) => void) | undefined } {
  let nextCallback = 0
  const callbacks = new Map<number, (response: unknown) => void>()
  stubGlobal('window', globalThis)
  stubGlobal('__TAURI_INTERNALS__', {
    invoke: async (cmd: string, args: unknown, options?: { headers?: Record<string, string> }) =>
      invoke(cmd, args, options),
    transformCallback: (callback?: (response: unknown) => void) => {
      const id = ++nextCallback
      if (callback) callbacks.set(id, callback)
      return id
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
  })
  stubGlobal('__TAURI_EVENT_PLUGIN_INTERNALS__', { unregisterListener: () => {} })
  return { callback: (id) => callbacks.get(id) }
}

/** Tauri のメモリ上の Store（plugin-store）。`plugin:store|*` の IPC に答える */
export function createFakeStoreIpc(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial))
  const calls: string[] = []
  const handle = (cmd: string, args: unknown): unknown => {
    const { key, value } = (args ?? {}) as { key?: string; value?: unknown }
    calls.push(cmd)
    switch (cmd) {
      case 'plugin:store|load':
        return 1
      case 'plugin:store|get':
        return [values.get(key ?? ''), values.has(key ?? '')]
      case 'plugin:store|set':
        values.set(key ?? '', value)
        return null
      case 'plugin:store|delete':
        return values.delete(key ?? '')
      case 'plugin:store|save':
        return null
      default:
        return undefined
    }
  }
  return { values, calls, handle }
}
