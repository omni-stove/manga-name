import { z } from 'zod'
import { LayoutSuggestionResponseSchema, NameDraftResponseSchema, PagePlanReplySchema } from './ai'
import { ProjectSchema } from './project'

/** LLM の構造化出力に渡す JSON Schema。手書きの JSON Schema も同じ型で渡せる */
export type JsonSchema = z.core.JSONSchema.BaseSchema

/**
 * LLM の構造化出力に渡す JSON Schema。参照整合の refine は JSON Schema に写らないので、
 * 構造と範囲だけを表す。応答は受け取った後に必ず Zod で検証する。
 */
export const projectJsonSchema = () => z.toJSONSchema(ProjectSchema, { io: 'input' })

/** LLM に返させるページ割り（PagePlanReplySchema）の JSON Schema */
export const pagePlanJsonSchema = (): JsonSchema =>
  z.toJSONSchema(PagePlanReplySchema, { io: 'input' })

/** AI のネームの書き起こしの応答の JSON Schema */
export const nameDraftJsonSchema = (): JsonSchema =>
  z.toJSONSchema(NameDraftResponseSchema, { io: 'input' })

/** AI のコマ割りの提案の応答の JSON Schema */
export const layoutSuggestionJsonSchema = (): JsonSchema =>
  z.toJSONSchema(LayoutSuggestionResponseSchema, { io: 'input' })

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('projectJsonSchema describes Project as an object with schemaVersion 20', () => {
    const schema = projectJsonSchema()
    expect(schema.type).toBe('object')
    expect(schema.properties?.schemaVersion).toMatchObject({ const: 20 })
  })

  test('pagePlanJsonSchema describes an object holding the array of pages', () => {
    const schema = pagePlanJsonSchema()
    expect(schema).toMatchObject({ type: 'object', required: ['pages'] })
    expect(schema.properties?.pages).toMatchObject({
      type: 'array',
      items: { required: ['note', 'script', 'cast', 'lines'] },
    })
  })

  test('nameDraftJsonSchema describes an object of panels', () => {
    const schema = nameDraftJsonSchema()
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['panels'])
  })

  test('layoutSuggestionJsonSchema describes an object of options', () => {
    const schema = layoutSuggestionJsonSchema()
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['options'])
  })
}
