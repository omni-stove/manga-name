import type { PageArtRequest, PanelArtRequest } from '@manga/ai'
import { fixtures, type Page } from '@manga/schema'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createGeminiImageProvider } from '../src/gemini-image-provider'

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent'

const { settings, characters } = fixtures.samplePage01
const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
const panelId = page.panels[0]?.id as string

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

function request(overrides: Partial<PanelArtRequest> = {}): PanelArtRequest {
  return {
    project: { settings, characters },
    page,
    panelId,
    layoutPng: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    ...overrides,
  }
}

/** generateContent の応答。parts をそのまま 1 つ目の候補に入れる */
const reply = (parts: unknown[]) => Response.json({ candidates: [{ content: { parts } }] })

type Part = { text?: string; inlineData?: { mimeType: string; data: string } }

interface SentBody {
  contents: { role: string; parts: Part[] }[]
  generationConfig: {
    responseModalities: string[]
    imageConfig: { imageSize: string; aspectRatio: string }
  }
}

let fetchMock = vi.fn<typeof fetch>()
const sentBody = () => JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as SentBody

const toPng = vi.fn(async (_: Blob) => new Blob([PNG_BYTES], { type: 'image/png' }))
const provider = createGeminiImageProvider({ apiKey: 'test-key', toPng })

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  fetchMock.mockResolvedValue(
    reply([{ inlineData: { mimeType: 'image/png', data: b64(PNG_BYTES) } }]),
  )
  vi.stubGlobal('fetch', fetchMock)
  toPng.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('request', () => {
  test('POSTs to generateContent with the key, a 1K image and the prompt with avoid', async () => {
    const res = await provider.generatePanelArt(request())
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(ENDPOINT)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-key')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')

    const body = sentBody()
    expect(body.generationConfig).toMatchObject({
      responseModalities: ['IMAGE'],
      imageConfig: { imageSize: '1K' },
    })
    const parts = body.contents[0]?.parts ?? []
    expect(body.contents[0]?.role).toBe('user')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({
      inlineData: { mimeType: 'image/png', data: b64(new Uint8Array([1, 2, 3])) },
    })
    expect(parts[1]?.text).toBe(res.prompt)
    expect(res.prompt.endsWith(`\navoid: ${settings.style.negative}`)).toBe(true)
    expect(res.provider).toBe('gemini-nano-banana-2.1')
  })

  test('leaves out avoid when the style has no negative', async () => {
    const style = { prompt: settings.style.prompt }
    const res = await provider.generatePanelArt(
      request({ project: { settings: { ...settings, style }, characters } }),
    )
    expect(res.prompt).not.toContain('avoid:')
    expect(sentBody().contents[0]?.parts.at(-1)?.text).toBe(res.prompt)
  })

  test('orders layout, reference, named character refs, the previous art and the prompt', async () => {
    const blob = (byte: number, type = 'image/png') => new Blob([new Uint8Array([byte])], { type })
    const res = await provider.generatePanelArt(
      request({
        referencePng: blob(10),
        characterRefs: [
          { characterId: 'chr_e', image: blob(20, 'image/jpeg') },
          { characterId: 'chr_unknown', image: blob(30) },
        ],
        previous: { art: blob(40), instruction: '目を大きく' },
      }),
    )
    const parts = sentBody().contents[0]?.parts ?? []
    expect(parts).toEqual([
      { inlineData: { mimeType: 'image/png', data: b64(new Uint8Array([1, 2, 3])) } },
      { inlineData: { mimeType: 'image/png', data: b64(new Uint8Array([10])) } },
      { text: 'E' },
      { inlineData: { mimeType: 'image/jpeg', data: b64(new Uint8Array([20])) } },
      { inlineData: { mimeType: 'image/png', data: b64(new Uint8Array([40])) } },
      { text: res.prompt },
    ])
    expect(res.prompt).toContain('revise the previous image: 目を大きく')
  })

  test('sends image/png for a blob without a type', async () => {
    await provider.generatePanelArt(request({ layoutPng: new Blob([new Uint8Array([1])]) }))
    expect(sentBody().contents[0]?.parts[0]?.inlineData?.mimeType).toBe('image/png')
  })

  test('encodes images larger than one String.fromCharCode chunk', async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251)
    await provider.generatePanelArt(
      request({ layoutPng: new Blob([bytes], { type: 'image/png' }) }),
    )
    const data = sentBody().contents[0]?.parts[0]?.inlineData?.data ?? ''
    expect(Uint8Array.from(atob(data), (c) => c.charCodeAt(0))).toEqual(bytes)
  })

  test.each([
    [{ w: 1, h: 1 }, { w: 0.5, h: 0.5 }, '1:1'],
    [{ w: 1, h: 1 }, { w: 0.8, h: 0.45 }, '16:9'],
    [{ w: 1, h: 1 }, { w: 0.45, h: 0.8 }, '9:16'],
    [{ w: 1, h: 1 }, { w: 1, h: 0.1 }, '21:9'],
    [{ w: 182, h: 257 }, { w: 1, h: 1 }, '3:4'],
    [{ w: 200, h: 100 }, { w: 0.5, h: 1 }, '1:1'],
  ])('aspect ratio for page %o and panel %o is %s', async (pageSize, size, expected) => {
    const resized = structuredClone(page)
    const panel = resized.panels[0]
    if (!panel) throw new Error('fixture has no panel')
    panel.rect = { x: 0, y: 0, ...size }
    await provider.generatePanelArt(
      request({
        page: resized,
        project: { settings: { ...settings, pageSize: { ...pageSize, unit: 'mm' } }, characters },
      }),
    )
    expect(sentBody().generationConfig.imageConfig.aspectRatio).toBe(expected)
  })

  test('throws when the panel is not on the page, without calling Gemini', async () => {
    await expect(provider.generatePanelArt(request({ panelId: 'missing' }))).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('response', () => {
  test('returns a PNG as is', async () => {
    const res = await provider.generatePanelArt(request())
    expect(res.image.type).toBe('image/png')
    expect(new Uint8Array(await res.image.arrayBuffer())).toEqual(PNG_BYTES)
    expect(toPng).not.toHaveBeenCalled()
  })

  test('takes the first part with image data, skipping text parts', async () => {
    fetchMock.mockResolvedValueOnce(
      reply([
        { text: 'here you go' },
        { inlineData: { mimeType: 'image/png', data: b64(PNG_BYTES) } },
      ]),
    )
    const res = await provider.generatePanelArt(request())
    expect(new Uint8Array(await res.image.arrayBuffer())).toEqual(PNG_BYTES)
  })

  test('converts a JPEG with toPng', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 9])
    fetchMock.mockResolvedValueOnce(
      reply([{ inlineData: { mimeType: 'image/jpeg', data: b64(jpeg) } }]),
    )
    const res = await provider.generatePanelArt(request())
    expect(toPng).toHaveBeenCalledTimes(1)
    const given = toPng.mock.calls[0]?.[0] as Blob
    expect(given.type).toBe('image/jpeg')
    expect(new Uint8Array(await given.arrayBuffer())).toEqual(jpeg)
    expect(new Uint8Array(await res.image.arrayBuffer())).toEqual(PNG_BYTES)
  })

  test('treats image data without a mimeType as PNG', async () => {
    fetchMock.mockResolvedValueOnce(reply([{ inlineData: { data: b64(PNG_BYTES) } }]))
    const res = await provider.generatePanelArt(request())
    expect(res.image.type).toBe('image/png')
    expect(toPng).not.toHaveBeenCalled()
  })

  test('returns an empty PNG blob with the prompt when there is no image', async () => {
    for (const body of [
      {},
      { candidates: [] },
      { candidates: [{ content: { parts: [{ text: 'no' }] } }] },
    ]) {
      fetchMock.mockResolvedValueOnce(Response.json(body))
      const res = await provider.generatePanelArt(request())
      expect(res.image.size, JSON.stringify(body)).toBe(0)
      expect(res.image.type).toBe('image/png')
      expect(res.prompt).toContain(settings.style.prompt)
    }
  })

  test('throws on an HTTP error with the status and body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('quota exceeded', { status: 429 }))
    await expect(provider.generatePanelArt(request())).rejects.toThrow(
      'gemini responded 429: quota exceeded',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('generatePageArt', () => {
  const pageRequest = (overrides: Partial<PageArtRequest> = {}): PageArtRequest => ({
    project: { settings, characters },
    page,
    layoutPng: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    ...overrides,
  })

  test('sends the layout, the reference, named character refs and the page prompt', async () => {
    const blob = (byte: number) => new Blob([new Uint8Array([byte])], { type: 'image/png' })
    const res = await provider.generatePageArt(
      pageRequest({
        referencePng: blob(10),
        characterRefs: [{ characterId: 'chr_e', image: blob(20) }],
      }),
    )
    expect(sentBody().contents[0]?.parts).toEqual([
      { inlineData: { mimeType: 'image/png', data: b64(new Uint8Array([1, 2, 3])) } },
      { inlineData: { mimeType: 'image/png', data: b64(new Uint8Array([10])) } },
      { text: 'E' },
      { inlineData: { mimeType: 'image/png', data: b64(new Uint8Array([20])) } },
      { text: res.prompt },
    ])
    expect(res.prompt).toContain('panel 1 (')
    expect(res.prompt.endsWith(`\navoid: ${settings.style.negative}`)).toBe(true)
  })

  test.each([
    [{ w: 182, h: 257 }, '3:4'],
    [{ w: 257, h: 182 }, '4:3'],
    [{ w: 100, h: 100 }, '1:1'],
  ])('aspect ratio for page %o is %s', async (pageSize, expected) => {
    await provider.generatePageArt(
      pageRequest({
        project: { settings: { ...settings, pageSize: { ...pageSize, unit: 'mm' } }, characters },
      }),
    )
    expect(sentBody().generationConfig.imageConfig).toEqual({
      imageSize: '1K',
      aspectRatio: expected,
    })
  })

  test('sends at most 4 character refs, skipping unknown characters', async () => {
    const cast = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      name: `N${i}`,
      shortName: `${i}`,
    }))
    await provider.generatePageArt(
      pageRequest({
        project: { settings, characters: cast },
        characterRefs: [
          { characterId: 'missing', image: new Blob([new Uint8Array([9])]) },
          ...cast.map((c) => ({ characterId: c.id, image: new Blob([new Uint8Array([1])]) })),
        ],
      }),
    )
    const names = (sentBody().contents[0]?.parts ?? [])
      .slice(1, -1)
      .flatMap((p) => (p.text ? [p.text] : []))
    expect(names).toEqual(['N0', 'N1', 'N2', 'N3'])
  })
})

describe('generateCharacterArt', () => {
  test('sends only the prompt with the negative appended, in 3:4', async () => {
    const character = { id: 'c', name: 'エル', shortName: 'L', appearance: '銀髪' }
    const res = await provider.generateCharacterArt({
      project: { settings: { ...settings, style: { prompt: 'ink', negative: 'color' } } },
      character,
    })
    const body = sentBody()
    expect(body.generationConfig.imageConfig).toEqual({ imageSize: '1K', aspectRatio: '3:4' })
    expect(body.contents[0]?.parts).toEqual([{ text: res.prompt }])
    expect(res.prompt).toContain('エル: 銀髪')
    expect(res.prompt.endsWith('\navoid: color')).toBe(true)
    expect(new Uint8Array(await res.image.arrayBuffer())).toEqual(PNG_BYTES)
  })
})
