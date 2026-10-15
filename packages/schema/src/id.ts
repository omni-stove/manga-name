import { nanoid } from 'nanoid'
import type { ID } from './project'

export const newId = (): ID => nanoid()

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('newId returns distinct nanoid strings', () => {
    const a = newId()
    expect(a).toMatch(/^[A-Za-z0-9_-]{21}$/)
    expect(newId()).not.toBe(a)
  })
}
