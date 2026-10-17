/** W3C WebDriver が要素の参照に使うキー */
const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'

export interface WebDriverSession {
  /** XPath に合う要素が表示されるまで待ち、その参照を返す */
  waitFor(xpath: string, timeout?: number): Promise<string>
  /** XPath に合う要素が表示されるまで待ってクリックする */
  click(xpath: string): Promise<void>
  /** WebView の PNG スクリーンショット */
  screenshot(): Promise<Buffer>
  /** WebView の HTML */
  source(): Promise<string>
  quit(): Promise<void>
}

/**
 * `driverUrl` の WebDriver サーバ（tauri-driver）にセッションを開く。
 * 要るのは要素を探してクリックすることだけなので、クライアントのライブラリは入れずにプロトコルを直接叩く
 */
export async function createWebDriverSession(
  driverUrl: string,
  capabilities: Record<string, unknown>,
): Promise<WebDriverSession> {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${driverUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await res.json()) as { value: T & { error?: string; message?: string } }
    if (!res.ok) throw new Error(`${method} ${path}: ${json.value.error} ${json.value.message}`)
    return json.value
  }

  const { sessionId } = await call<{ sessionId: string }>('POST', '/session', {
    capabilities: { alwaysMatch: capabilities },
  })
  const session = (path: string) => `/session/${sessionId}${path}`

  const findAll = async (xpath: string) => {
    const found = await call<Record<string, string>[]>('POST', session('/elements'), {
      using: 'xpath',
      value: xpath,
    })
    return found.map((e) => e[ELEMENT_KEY] as string)
  }

  const isDisplayed = (id: string) => call<boolean>('GET', session(`/element/${id}/displayed`))

  const waitFor = async (xpath: string, timeout = 15_000) => {
    const deadline = Date.now() + timeout
    for (;;) {
      for (const id of await findAll(xpath)) {
        // 描き直しで要素が差し替わると、探した直後の参照でも stale になる
        if (await isDisplayed(id).catch(() => false)) return id
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${xpath}`)
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  return {
    waitFor,
    async click(xpath) {
      const id = await waitFor(xpath)
      await call('POST', session(`/element/${id}/click`), {})
    },
    async screenshot() {
      return Buffer.from(await call<string>('GET', session('/screenshot')), 'base64')
    },
    source: () => call('GET', session('/source')),
    async quit() {
      await call('DELETE', session(''))
    },
  }
}
