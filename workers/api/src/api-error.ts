import {
  API_ERRORS,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiErrorParams,
} from '@manga/schema'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'

type Options<C extends ApiErrorCode> = {
  detail?: string
  headers?: Record<string, string>
} & (ApiErrorParams<C> extends undefined ? { params?: undefined } : { params: ApiErrorParams<C> })

/**
 * API_ERRORS の code で応答を返すための例外。ステータスは code から決まり、params を持つ code は params が要る。
 * app の onError（handleError）が ApiErrorBody の JSON にする
 */
export class ApiException<C extends ApiErrorCode = ApiErrorCode> extends HTTPException {
  readonly code: C
  readonly options: Options<C> | undefined

  constructor(
    code: C,
    ...[options]: ApiErrorParams<C> extends undefined ? [Options<C>?] : [Options<C>]
  ) {
    super(API_ERRORS[code].status as ContentfulStatusCode, { message: code })
    this.code = code
    this.options = options
  }

  toBody(): ApiErrorBody {
    const { detail, params } = this.options ?? {}
    return { code: this.code, detail, params } as ApiErrorBody
  }
}

/** schema で value を検証し、通らなければ zod の説明を detail に載せた invalid_request を throw する */
export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new ApiException('invalid_request', { detail: z.prettifyError(parsed.error) })
  }
  return parsed.data
}

/** app.onError。ApiException は本文に、それ以外の HTTPException はその応答に、他の例外は internal_error にする */
export function handleError(err: Error, c: Context) {
  if (err instanceof ApiException) {
    return c.json(err.toBody(), err.status, err.options?.headers)
  }
  if (err instanceof HTTPException) return err.getResponse()
  console.error(err)
  return c.json({ code: 'internal_error' } satisfies ApiErrorBody, 500)
}
