import { findPanel, type ImageProvider, type PanelArtRequest, prompts } from '@manga/ai'
import type { Character } from '@manga/schema'

const GEMINI_IMAGE_MODEL = 'gemini-nano-banana-2.1'

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`

/** imageConfig.aspectRatio が受け付ける比。コマやページの比はここから最も近いものに丸める */
const ASPECT_RATIOS = [
  [1, 1],
  [2, 3],
  [3, 2],
  [3, 4],
  [4, 3],
  [4, 5],
  [5, 4],
  [9, 16],
  [16, 9],
  [21, 9],
] as const

export interface GeminiImageProviderOptions {
  apiKey: string
  /** PNG 以外の画像を PNG にする。Gemini は JPEG で返し、出力形式を指定する欄も無いため */
  toPng(image: Blob): Promise<Blob>
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[]
}

/** 1 回に渡せるキャラの参照画像の上限。Gemini は参照画像を計 14 枚、うちキャラを 4 枚まで受ける */
const MAX_CHARACTER_REFS = 4

/** 実寸の幅 / 高さに最も近い aspectRatio。比の対数の差で比べる */
function aspectRatio(width: number, height: number): string {
  const target = Math.log(width / height)
  const [w, h] = ASPECT_RATIOS.reduce((best, r) =>
    Math.abs(Math.log(r[0] / r[1]) - target) < Math.abs(Math.log(best[0] / best[1]) - target)
      ? r
      : best,
  )
  return `${w}:${h}`
}

function base64(bytes: Uint8Array): string {
  // String.fromCharCode に配列を一度に渡すと大きな画像で引数の上限を超えるので、区切って変換する
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function imagePart(blob: Blob): Promise<Part> {
  return {
    inlineData: {
      mimeType: blob.type || 'image/png',
      data: base64(new Uint8Array(await blob.arrayBuffer())),
    },
  }
}

/** キャラの参照画像の比。全身を縦に収める */
const CHARACTER_ASPECT_RATIO = '3:4'

/** negative は Gemini に専用の欄が無いので「avoid: 」としてプロンプトの末尾に足す */
const withNegative = ({ prompt, negative }: { prompt: string; negative: string }) =>
  `${prompt}\navoid: ${negative}`

/** キャラ参照の parts。直前のテキスト part にキャラ名を置く。居ないキャラは飛ばし、先頭から MAX_CHARACTER_REFS 人まで */
async function characterParts(
  refs: PanelArtRequest['characterRefs'],
  characters: readonly Character[],
): Promise<Part[]> {
  const known = (refs ?? []).flatMap((ref) => {
    const character = characters.find((c) => c.id === ref.characterId)
    return character ? [{ name: character.name, image: ref.image }] : []
  })
  const parts = await Promise.all(
    known
      .slice(0, MAX_CHARACTER_REFS)
      .map(async ({ name, image }): Promise<Part[]> => [{ text: name }, await imagePart(image)]),
  )
  return parts.flat()
}

/**
 * Gemini `gemini-nano-banana-2.1` の generateContent で 1K の画像を 1 枚生成する ImageProvider。
 * コマの parts は配置図、参照画像、キャラ参照（直前のテキスト part にキャラ名）、前回の絵、プロンプトの順。比はコマの実寸に最も近いもの。
 * ページの parts は前回の絵が無いほかは同じで、比は判型に最も近いもの。キャラ参照はどちらも先頭の 4 人まで。
 * キャラの参照画像の parts はプロンプトだけで、比は 3:4。
 * negative は「avoid: 」としてプロンプトの末尾に足し、足した後の文を prompt として返す。
 * 応答の画像が PNG でなければ toPng で変換する。画像が無ければ空の Blob を返し、PNG かどうかの判定と再試行は呼び出し側に任せる。HTTP エラーは status だけを載せて throw する。
 */
export function createGeminiImageProvider(opts: GeminiImageProviderOptions): ImageProvider {
  const generate = async (parts: Part[], aspectRatio: string, prompt: string) => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { imageSize: '1K', aspectRatio },
        },
      }),
    })
    if (!res.ok) {
      // 本文はリクエストの内容を返すことがあり、例外はログに残るので status だけにする
      await res.body?.cancel()
      throw new Error(`gemini responded ${res.status}`)
    }
    const body: GenerateContentResponse = await res.json()
    const inline = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
    if (!inline?.data) {
      return { image: new Blob([], { type: 'image/png' }), provider: GEMINI_IMAGE_MODEL, prompt }
    }
    const mimeType = inline.mimeType ?? 'image/png'
    const raw = new Blob([decodeBase64(inline.data)], { type: mimeType })
    const image = mimeType === 'image/png' ? raw : await opts.toPng(raw)
    return { image, provider: GEMINI_IMAGE_MODEL, prompt }
  }

  return {
    async generatePanelArt(req) {
      const prompt = withNegative(
        prompts.panelArt({ ...req, instruction: req.previous?.instruction }),
      )
      const panel = findPanel(req.page, req.panelId)

      const { pageSize } = req.project.settings

      const parts: Part[] = [await imagePart(req.layoutPng)]
      if (req.referencePng) parts.push(await imagePart(req.referencePng))
      parts.push(...(await characterParts(req.characterRefs, req.project.characters)))
      if (req.previous) parts.push(await imagePart(req.previous.art))
      parts.push({ text: prompt })
      return generate(
        parts,
        aspectRatio(panel.rect.w * pageSize.w, panel.rect.h * pageSize.h),
        prompt,
      )
    },
    async generatePageArt(req) {
      const prompt = withNegative(prompts.pageArt(req))
      const { pageSize } = req.project.settings

      const parts: Part[] = [await imagePart(req.layoutPng)]
      if (req.referencePng) parts.push(await imagePart(req.referencePng))
      parts.push(...(await characterParts(req.characterRefs, req.project.characters)))
      parts.push({ text: prompt })
      return generate(parts, aspectRatio(pageSize.w, pageSize.h), prompt)
    },
    async generateCharacterArt(req) {
      const prompt = withNegative(prompts.characterArt(req))
      return generate([{ text: prompt }], CHARACTER_ASPECT_RATIO, prompt)
    },
  }
}
