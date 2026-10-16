import { CritiqueResponseSchema, LayoutProposalResponseSchema } from '@manga/schema'
import type { HttpProviderOptions } from './http-image-provider'
import type { LlmProvider } from './provider'

/**
 * Workers のプロキシ `POST /v1/ai/propose-layout` と `POST /v1/ai/critique` に JSON を送る LlmProvider。
 * 応答は `@manga/schema` で検証して返す。トークン無し、HTTP エラー、検証に通らない応答は throw する。
 */
export function createHttpLlmProvider(opts: HttpProviderOptions): LlmProvider {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')

  async function postJson(path: string, body: unknown): Promise<unknown> {
    const token = await opts.getToken()
    if (token === null) throw new Error('access token is not set')

    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${path} request failed: ${res.status}`)
    return res.json()
  }

  return {
    async proposeLayout(req) {
      return LayoutProposalResponseSchema.parse(await postJson('/v1/ai/propose-layout', req))
    },
    async critique(req) {
      return CritiqueResponseSchema.parse(await postJson('/v1/ai/critique', req))
    },
  }
}

if (import.meta.vitest) {
  const { expect, test, vi, afterEach } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const { aiFixtures } = await import('./fake-llm-provider')

  const { settings, characters } = fixtures.samplePage01
  const req = { project: { settings, characters }, script: 'E「……」', pageCount: 1 }

  afterEach(() => vi.unstubAllGlobals())

  test('proposeLayout posts the request as JSON with the bearer token', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual(req)
      expect(init.headers).toMatchObject({
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      })
      return Response.json(aiFixtures.layoutProposal)
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createHttpLlmProvider({
      baseUrl: 'https://api.example/',
      getToken: async () => 'tok',
    })
    expect(await provider.proposeLayout(req)).toEqual(aiFixtures.layoutProposal)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example/v1/ai/propose-layout')
  })

  test('proposeLayout throws without a token, on HTTP errors and on invalid JSON', async () => {
    await expect(
      createHttpLlmProvider({ baseUrl: 'x', getToken: async () => null }).proposeLayout(req),
    ).rejects.toThrow('access token')

    const provider = createHttpLlmProvider({ baseUrl: 'x', getToken: async () => 't' })
    vi.stubGlobal('fetch', async () => new Response('no', { status: 502 }))
    await expect(provider.proposeLayout(req)).rejects.toThrow('502')

    vi.stubGlobal('fetch', async () => Response.json({ pages: 'none' }))
    await expect(provider.proposeLayout(req)).rejects.toThrow()
  })

  test('critique posts the page and diagnosis and validates the reply', async () => {
    const page = fixtures.samplePage01.episodes[0]?.pages[0]
    if (!page) throw new Error('fixture has no page')
    const critiqueReq = {
      page,
      diagnosis: {
        pageId: page.id,
        readingOrderOk: true,
        inferredOrder: [],
        panels: [],
        bubbleChain: [],
        summary: { total: 0, ok: 0, weak: 0, miss: 0 },
        issues: [],
      },
    }
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual(critiqueReq)
      return Response.json(aiFixtures.critique)
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = createHttpLlmProvider({
      baseUrl: 'https://api.example',
      getToken: async () => 't',
    })
    expect(await provider.critique(critiqueReq)).toEqual(aiFixtures.critique)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example/v1/ai/critique')

    vi.stubGlobal('fetch', async () => Response.json({ summary: 's', suggestions: [{}] }))
    await expect(provider.critique(critiqueReq)).rejects.toThrow()
  })
}
