import { prompts } from './prompts'
import type { ImageProvider } from './provider'

export interface HttpProviderOptions {
  /** Workers のプロキシの origin。末尾の `/` は有っても無くても良い */
  baseUrl: string
  /** Bearer トークン。未入力なら null */
  getToken(): Promise<string | null>
}

/** プロキシが応答ヘッダに載せる、実際に使ったプロバイダ名とプロンプト（URI エンコード） */
export const PROVIDER_HEADER = 'x-ai-provider'
export const PROMPT_HEADER = 'x-ai-prompt'

/**
 * Workers のプロキシ `POST /v1/ai/panel-art` を叩く ImageProvider。
 * multipart は json（Blob を除いた PanelArtRequest）/ layout / reference / character_<id> / previous で組み立てる。
 * トークン無しと HTTP エラーは throw する。
 */
export function createHttpImageProvider(opts: HttpProviderOptions): ImageProvider {
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/v1/ai/panel-art`

  return {
    async generatePanelArt(req) {
      const token = await opts.getToken()
      if (token === null) throw new Error('access token is not set')

      const form = new FormData()
      form.set(
        'json',
        JSON.stringify({
          project: req.project,
          page: req.page,
          panelId: req.panelId,
          hint: req.hint,
          previous: req.previous && { instruction: req.previous.instruction },
        }),
      )
      form.set('layout', req.layoutPng, 'layout.png')
      if (req.referencePng) form.set('reference', req.referencePng, 'reference.png')
      for (const ref of req.characterRefs ?? []) {
        form.set(`character_${ref.characterId}`, ref.image, `${ref.characterId}.png`)
      }
      if (req.previous) form.set('previous', req.previous.art, 'previous.png')

      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) throw new Error(`panel-art request failed: ${res.status}`)

      const encodedPrompt = res.headers.get(PROMPT_HEADER)
      return {
        image: new Blob([await res.arrayBuffer()], { type: 'image/png' }),
        provider: res.headers.get(PROVIDER_HEADER) ?? 'http',
        // ヘッダが無い旧版のプロキシでも PanelArt.prompt を埋められるよう、手元で組み立てて代える
        prompt: encodedPrompt
          ? decodeURIComponent(encodedPrompt)
          : prompts.panelArt({ ...req, instruction: req.previous?.instruction }).prompt,
      }
    },
  }
}

if (import.meta.vitest) {
  const { expect, test, vi, afterEach } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')

  const page = fixtures.samplePage01.episodes[0]?.pages[0]
  const panel = page?.panels[0]
  if (!page || !panel) throw new Error('fixture has no panel')
  const req = {
    project: fixtures.samplePage01,
    page,
    panelId: panel.id,
    layoutPng: new Blob(['l']),
  }

  afterEach(() => vi.unstubAllGlobals())

  // FormData.get の戻り型は DOM lib と workers-types で違い、どちらでも通る形にするため
  const fileText = (entry: unknown) => (entry as File).text()

  test('generatePanelArt posts a multipart request with the bearer token', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData
      expect([...form.keys()].sort()).toEqual(
        ['character_c1', 'json', 'layout', 'previous', 'reference'].sort(),
      )
      const json = JSON.parse(form.get('json') as string)
      expect(json.panelId).toBe(panel.id)
      expect(json.previous).toEqual({ instruction: 'darker' })
      expect(await fileText(form.get('layout'))).toBe('l')
      expect(await fileText(form.get('previous'))).toBe('p')
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { [PROVIDER_HEADER]: 'real', [PROMPT_HEADER]: encodeURIComponent('絵') },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createHttpImageProvider({
      baseUrl: 'https://api.example/',
      getToken: async () => 'tok',
    })
    const res = await provider.generatePanelArt({
      ...req,
      referencePng: new Blob(['r']),
      characterRefs: [{ characterId: 'c1', image: new Blob(['c']) }],
      previous: { art: new Blob(['p']), instruction: 'darker' },
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example/v1/ai/panel-art')
    expect(res.provider).toBe('real')
    expect(res.prompt).toBe('絵')
    expect(new Uint8Array(await res.image.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('generatePanelArt throws without a token and on HTTP errors', async () => {
    await expect(
      createHttpImageProvider({ baseUrl: 'x', getToken: async () => null }).generatePanelArt(req),
    ).rejects.toThrow('access token')

    vi.stubGlobal('fetch', async () => new Response('no', { status: 502 }))
    await expect(
      createHttpImageProvider({ baseUrl: 'x', getToken: async () => 't' }).generatePanelArt(req),
    ).rejects.toThrow('502')
  })
}
