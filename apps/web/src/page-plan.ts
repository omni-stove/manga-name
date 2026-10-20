import { m } from '@manga/i18n'

/** ページ数の欄に一押しで入れる、商業誌の 1 回分の目安。`pages` は MAX_PAGE_COUNT 以下 */
export const PAGE_COUNT_GUIDES: readonly { label: string; pages: number; hint: string }[] = [
  {
    get label() {
      return m.web_page_count_guide_weekly()
    },
    pages: 19,
    get hint() {
      return m.web_page_count_guide_weekly_hint()
    },
  },
  {
    get label() {
      return m.web_page_count_guide_monthly()
    },
    pages: 32,
    get hint() {
      return m.web_page_count_guide_monthly_hint()
    },
  },
  {
    get label() {
      return m.web_page_count_guide_oneshot()
    },
    pages: 31,
    get hint() {
      return m.web_page_count_guide_oneshot_hint()
    },
  },
  {
    get label() {
      return m.web_page_count_guide_premiere()
    },
    pages: 50,
    get hint() {
      return m.web_page_count_guide_premiere_hint()
    },
  },
]

/**
 * `run` を呼び、`signal` が abort されたらその時点で `signal.reason` で reject する。
 * LlmProvider は signal を受けないので、abort 後に届いた応答はここで捨てる
 */
export function abortable<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    run()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { parsePageCount } = await import('@manga/ai')

  test('every page count guide is accepted by the page count field', () => {
    for (const g of PAGE_COUNT_GUIDES) expect(parsePageCount(String(g.pages))).toBe(g.pages)
  })

  describe('abortable', () => {
    test('resolves with the result and passes errors through', async () => {
      const signal = new AbortController().signal
      await expect(abortable(async () => 1, signal)).resolves.toBe(1)
      await expect(abortable(async () => Promise.reject(new Error('502')), signal)).rejects.toThrow(
        '502',
      )
    })

    test('rejects on abort and drops the result that arrives later', async () => {
      let respond: (n: number) => void = () => {}
      const run = vi.fn(
        () =>
          new Promise<number>((r) => {
            respond = r
          }),
      )
      const controller = new AbortController()
      const pending = abortable(run, controller.signal)
      controller.abort()
      respond(1)
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await expect(abortable(run, controller.signal)).rejects.toBeDefined()
      expect(run).toHaveBeenCalledTimes(1)
    })
  })
}
