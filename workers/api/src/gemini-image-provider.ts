import { findPanel, type ImageProvider, prompts } from '@manga/ai'
import type { Panel, ProjectSettings } from '@manga/schema'

const GEMINI_IMAGE_MODEL = 'gemini-nano-banana-2.1'

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`

/** imageConfig.aspectRatio が受け付ける比。コマの比はここから最も近いものに丸める */
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

/** コマの実寸の幅 / 高さに最も近い aspectRatio。比の対数の差で比べる */
function aspectRatio(panel: Panel, settings: ProjectSettings): string {
  const target = Math.log(
    (panel.rect.w * settings.pageSize.w) / (panel.rect.h * settings.pageSize.h),
  )
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

/**
 * Gemini `gemini-nano-banana-2.1` の generateContent で 1K の画像を 1 枚生成する ImageProvider。
 * parts は配置図、参照画像、キャラ参照（直前のテキスト part にキャラ名）、前回の絵、プロンプトの順。
 * negative は Gemini に専用の欄が無いので「avoid: 」としてプロンプトの末尾に足し、足した後の文を prompt として返す。
 * 応答の画像が PNG でなければ toPng で変換する。画像が無ければ空の Blob を返し、PNG かどうかの判定と再試行は呼び出し側に任せる。HTTP エラーは throw する。
 */
export function createGeminiImageProvider(opts: GeminiImageProviderOptions): ImageProvider {
  return {
    async generatePanelArt(req) {
      const { prompt: base, negative } = prompts.panelArt({
        ...req,
        instruction: req.previous?.instruction,
      })
      const prompt = negative ? `${base}\navoid: ${negative}` : base
      const panel = findPanel(req.page, req.panelId)

      const parts: Part[] = [await imagePart(req.layoutPng)]
      if (req.referencePng) parts.push(await imagePart(req.referencePng))
      for (const ref of req.characterRefs ?? []) {
        const character = req.project.characters.find((c) => c.id === ref.characterId)
        if (!character) continue
        parts.push({ text: character.name }, await imagePart(ref.image))
      }
      if (req.previous) parts.push(await imagePart(req.previous.art))
      parts.push({ text: prompt })

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: {
              imageSize: '1K',
              aspectRatio: aspectRatio(panel, req.project.settings),
            },
          },
        }),
      })
      if (!res.ok) throw new Error(`gemini responded ${res.status}: ${await res.text()}`)
      const body: GenerateContentResponse = await res.json()
      const inline = body.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData?.data,
      )?.inlineData
      if (!inline?.data) {
        return { image: new Blob([], { type: 'image/png' }), provider: GEMINI_IMAGE_MODEL, prompt }
      }
      const mimeType = inline.mimeType ?? 'image/png'
      const raw = new Blob([decodeBase64(inline.data)], { type: mimeType })
      const image = mimeType === 'image/png' ? raw : await opts.toPng(raw)
      return { image, provider: GEMINI_IMAGE_MODEL, prompt }
    },
  }
}
