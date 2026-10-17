import { readApiError } from '@manga/schema'
import { prompts } from './prompts'
import type { ImageProvider } from './provider'

export interface HttpProviderOptions {
  /** Workers のプロキシの origin。末尾の `/` は有っても無くても良い */
  baseUrl: string
  /** Bearer トークン。未入力なら null */
  getToken(): Promise<string | null>
}

/** トークンが無いか、プロキシが 401 を返したときに throw する。画面はこれを見てログインを促す */
export class SignInRequiredError extends Error {
  constructor() {
    super('ログインが必要です')
    this.name = 'SignInRequiredError'
  }
}

/** プロキシが応答ヘッダに載せる、実際に使ったプロバイダ名とプロンプト（URI エンコード） */
export const PROVIDER_HEADER = 'x-ai-provider'
export const PROMPT_HEADER = 'x-ai-prompt'

/**
 * Workers のプロキシ `POST /v1/ai/panel-art` と `POST /v1/ai/character-art` を叩く ImageProvider。
 * panel-art の multipart は json（Blob を除いた PanelArtRequest）/ layout / reference / character_<id> / previous で組み立て、
 * character-art は CharacterArtRequest を JSON で送る。
 * トークン無しと 401 は SignInRequiredError、ほかの HTTP エラーは readApiError の Error（多くは ApiError）を throw する。
 */
export function createHttpImageProvider(opts: HttpProviderOptions): ImageProvider {
  const base = opts.baseUrl.replace(/\/+$/, '')

  const post = async (path: string, init: { body: BodyInit; headers?: Record<string, string> }) => {
    const token = await opts.getToken()
    if (token === null) throw new SignInRequiredError()
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { ...init.headers, authorization: `Bearer ${token}` },
      body: init.body,
    })
    if (res.status === 401) throw new SignInRequiredError()
    if (!res.ok) throw await readApiError(res, `POST ${path}`)
    const encodedPrompt = res.headers.get(PROMPT_HEADER)
    return {
      image: new Blob([await res.arrayBuffer()], { type: 'image/png' }),
      provider: res.headers.get(PROVIDER_HEADER) ?? 'http',
      prompt: encodedPrompt ? decodeURIComponent(encodedPrompt) : undefined,
    }
  }

  return {
    async generatePanelArt(req) {
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

      const res = await post('/v1/ai/panel-art', { body: form })
      return {
        ...res,
        // ヘッダが無い旧版のプロキシでも PanelArt.prompt を埋められるよう、手元で組み立てて代える
        prompt:
          res.prompt ?? prompts.panelArt({ ...req, instruction: req.previous?.instruction }).prompt,
      }
    },
    async generateCharacterArt(req) {
      const res = await post('/v1/ai/character-art', {
        body: JSON.stringify(req),
        headers: { 'content-type': 'application/json' },
      })
      return { ...res, prompt: res.prompt ?? prompts.characterArt(req).prompt }
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

  test('generateCharacterArt posts the request as JSON with the bearer token', async () => {
    const character = { id: 'c1', name: 'エル', shortName: 'L', appearance: '銀髪' }
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({
        project: { settings: fixtures.samplePage01.settings },
        character,
      })
      const headers = init.headers as Record<string, string>
      expect(headers.authorization).toBe('Bearer tok')
      expect(headers['content-type']).toBe('application/json')
      return new Response(new Uint8Array([1]), { headers: { [PROVIDER_HEADER]: 'real' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const characterReq = { project: { settings: fixtures.samplePage01.settings }, character }
    const res = await createHttpImageProvider({
      baseUrl: 'https://api.example',
      getToken: async () => 'tok',
    }).generateCharacterArt(characterReq)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example/v1/ai/character-art')
    expect(res.provider).toBe('real')
    expect(res.prompt).toBe(prompts.characterArt(characterReq).prompt)
  })

  test('generatePanelArt throws without a token and on HTTP errors', async () => {
    await expect(
      createHttpImageProvider({ baseUrl: 'x', getToken: async () => null }).generatePanelArt(req),
    ).rejects.toBeInstanceOf(SignInRequiredError)

    vi.stubGlobal('fetch', async () => new Response('no', { status: 401 }))
    await expect(
      createHttpImageProvider({ baseUrl: 'x', getToken: async () => 't' }).generatePanelArt(req),
    ).rejects.toBeInstanceOf(SignInRequiredError)

    vi.stubGlobal('fetch', async () => new Response('no', { status: 502 }))
    await expect(
      createHttpImageProvider({ baseUrl: 'x', getToken: async () => 't' }).generatePanelArt(req),
    ).rejects.toThrow('502')
  })
}
