import { SCHEMA_VERSION } from './project'

/** 版 N の JSON を版 N+1 に上げる関数。キーは元の版 */
const migrations: Record<number, (json: Record<string, unknown>) => Record<string, unknown>> = {
  // v2 は Panel.shape を足しただけで、v1 の JSON はそのまま v2 として読める。版を上げるのは、
  // shape を知らない古いクライアントが v2 を読んで shape を落としたまま保存しないようにするため
  1: (json) => ({ ...json, schemaVersion: 2 }),
  // v3 は Bubble.overflow を足しただけ。版を上げる理由は v2 と同じ
  2: (json) => ({ ...json, schemaVersion: 3 }),
  // v4 は Page.cast を足しただけ。版を上げる理由は v2 と同じ
  3: (json) => ({ ...json, schemaVersion: 4 }),
  // v5 は Project.layoutTemplates を足しただけ。版を上げる理由は v2 と同じ
  4: (json) => ({ ...json, schemaVersion: 5 }),
  // v6 は Bubble.shape に形を足しただけ。版を上げるのは、知らない形を読んだ古いクライアントが壊れたデータとしてではなく
  // 新しい版として断るようにするため
  5: (json) => ({ ...json, schemaVersion: 6 }),
  // v7 は Panel、Bubble、FocusPoint、Vector の locked を足しただけ。版を上げる理由は v2 と同じ
  6: (json) => ({ ...json, schemaVersion: 7 }),
  // v8 は settings.style を除いただけで、残った style は ProjectSchema が読み捨てる。版を上げる理由は v6 と同じ
  7: (json) => ({ ...json, schemaVersion: 8 }),
  // v9 は Page.sketch を足しただけ。版を上げる理由は v2 と同じ
  8: (json) => ({ ...json, schemaVersion: 9 }),
}

/**
 * `schemaVersion` を最新（SCHEMA_VERSION）まで 1 つずつ上げる。最新ならそのまま返す。
 * `schemaVersion` が無い、最新より新しい、または移行手順がない場合は throw する。
 */
export function migrate(json: unknown): unknown {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('project JSON must be an object')
  }
  let current = json as Record<string, unknown>
  for (;;) {
    const version = current.schemaVersion
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      throw new Error('schemaVersion is missing or not an integer')
    }
    if (version === SCHEMA_VERSION) return current
    const step = migrations[version]
    if (version > SCHEMA_VERSION || !step) {
      throw new Error(`cannot migrate schemaVersion ${version} to ${SCHEMA_VERSION}`)
    }
    current = step(current)
  }
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('migrate v9 → v9 is a no-op', () => {
    const json = { schemaVersion: 9, title: 't' }
    expect(migrate(json)).toBe(json)
  })

  test('migrate v1 → v9 only bumps the version', () => {
    expect(migrate({ schemaVersion: 1, title: 't' })).toEqual({ schemaVersion: 9, title: 't' })
  })

  test('migrate rejects unknown, newer or missing versions and non-objects', () => {
    expect(() => migrate({ schemaVersion: 10 })).toThrow()
    expect(() => migrate({ schemaVersion: 0 })).toThrow()
    expect(() => migrate({})).toThrow()
    expect(() => migrate(null)).toThrow()
    expect(() => migrate([])).toThrow()
  })
}
