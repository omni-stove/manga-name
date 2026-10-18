import { z } from 'zod'
import { PagePlanResponseSchema } from './ai'
import { ProjectSchema } from './project'

/** LLM の構造化出力に渡す JSON Schema。手書きの JSON Schema も同じ型で渡せる */
export type JsonSchema = z.core.JSONSchema.BaseSchema

/**
 * LLM の構造化出力に渡す JSON Schema。参照整合の refine は JSON Schema に写らないので、
 * 構造と範囲だけを表す。応答は受け取った後に必ず Zod で検証する。
 */
export const projectJsonSchema = () => z.toJSONSchema(ProjectSchema, { io: 'input' })

/** AI のページ割り応答の JSON Schema */
export const pagePlanJsonSchema = (): JsonSchema =>
  z.toJSONSchema(PagePlanResponseSchema, { io: 'input' })

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('projectJsonSchema describes Project as an object with schemaVersion 5', () => {
    const schema = projectJsonSchema()
    expect(schema.type).toBe('object')
    expect(schema.properties?.schemaVersion).toMatchObject({ const: 5 })
  })

  test('pagePlanJsonSchema describes an array of pages', () => {
    const schema = pagePlanJsonSchema()
    expect(schema.type).toBe('array')
    expect(schema.items).toMatchObject({ required: ['note', 'cast', 'lines'] })
  })
}
