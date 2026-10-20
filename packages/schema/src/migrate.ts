import { type Camera, SCHEMA_VERSION } from './project'

/** v12 まで画面の候補として出していた呼び名 */
const CAMERA_NAMES: Record<string, Camera> = {
  ロング: 'long',
  ミドル: 'middle',
  バストアップ: 'bust',
  アップ: 'close_up',
  アオリ: 'low_angle',
  あおり: 'low_angle',
  俯瞰: 'high_angle',
}

type Json = Record<string, unknown>

/** 配列のうちオブジェクトの要素だけを fn で変える。形の違う値は ProjectSchema に断らせるのでそのまま残す */
const mapObjects = (value: unknown, fn: (item: Json) => Json): unknown =>
  Array.isArray(value)
    ? value.map((v) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? fn(v) : v))
    : value

/**
 * v12 の自由記述の Panel.camera を v13 の値にする。候補の呼び名はその値に、それ以外の記述は
 * 消さずに note の頭に移す
 */
function cameraToEnum(panel: Json): Json {
  const { camera, ...rest } = panel
  if (typeof camera !== 'string' || camera.trim() === '') return rest
  const key = camera.trim()
  const value = Object.hasOwn(CAMERA_NAMES, key) ? CAMERA_NAMES[key] : undefined
  if (value) return { ...rest, camera: value }
  const note =
    typeof panel.note === 'string' && panel.note !== '' ? `${camera}\n${panel.note}` : camera
  return { ...rest, note }
}

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
  // v10 は settings.characterDesign を足しただけ。版を上げる理由は v2 と同じ
  9: (json) => ({ ...json, schemaVersion: 10 }),
  // v11 は Panel.fill を足しただけ。版を上げる理由は v2 と同じ
  10: (json) => ({ ...json, schemaVersion: 11 }),
  // v12 は Panel.frame を足しただけ。版を上げる理由は v2 と同じ
  11: (json) => ({ ...json, schemaVersion: 12 }),
  // v13 は Panel.camera を自由記述から CameraSchema の値にした
  12: (json) => ({
    ...json,
    schemaVersion: 13,
    episodes: mapObjects(json.episodes, (episode) => ({
      ...episode,
      pages: mapObjects(episode.pages, (page) => ({
        ...page,
        panels: mapObjects(page.panels, cameraToEnum),
      })),
    })),
  }),
  // v14 は Page.side を除き、Page.spread と Episode.startsRight を足した。残った side は ProjectSchema が読み捨てる。
  // 版を上げる理由は v6 と同じ
  13: (json) => ({ ...json, schemaVersion: 14 }),
  // v15 は Page.ground、Page.tone と Panel.frame の値を足しただけ。版を上げる理由は v6 と同じ
  14: (json) => ({ ...json, schemaVersion: 15 }),
  // v16 は Bubble.typeface を足しただけ。版を上げる理由は v6 と同じ
  15: (json) => ({ ...json, schemaVersion: 16 }),
  // v17 は Page.overlay と Panel.frame の cloud を足しただけ。版を上げる理由は v6 と同じ
  16: (json) => ({ ...json, schemaVersion: 17 }),
  // v18 は Bubble.fill を足しただけ。版を上げる理由は v2 と同じ
  17: (json) => ({ ...json, schemaVersion: 18 }),
  // v19 は Panel.effect を足しただけ。版を上げる理由は v6 と同じ
  18: (json) => ({ ...json, schemaVersion: 19 }),
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

  test('migrate v19 → v19 is a no-op', () => {
    const json = { schemaVersion: 19, title: 't' }
    expect(migrate(json)).toBe(json)
  })

  test('migrate v1 → v19 only bumps the version of a project without cameras', () => {
    expect(migrate({ schemaVersion: 1, title: 't' })).toEqual({ schemaVersion: 19, title: 't' })
  })

  test('migrate v17 → v19 only bumps the version and leaves the bubbles white', () => {
    const bubbles = [{ id: 'bb', shape: 'normal' }]
    const json = { schemaVersion: 17, episodes: [{ pages: [{ panels: [{ bubbles }] }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 19 })
  })

  test('migrate v18 → v19 only bumps the version and leaves the panels without an effect', () => {
    const panels = [{ id: 'a', frame: 'cloud', camera: 'long' }]
    const json = { schemaVersion: 18, episodes: [{ pages: [{ overlay: 'gray', panels }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 19 })
  })

  test('migrate v12 → v19 turns the suggested camera names into values and moves the rest to the note', () => {
    const panels = [
      { id: 'a', camera: 'ロング' },
      { id: 'b', camera: ' あおり ' },
      { id: 'c', camera: '目元のアップ', note: 'レンズ越しの目' },
      { id: 'd', camera: 'ロング、俯瞰気味' },
      { id: 'e', camera: '' },
      { id: 'f', note: 'n' },
    ]
    const json = { schemaVersion: 12, episodes: [{ pages: [{ panels }] }] }
    expect(migrate(json)).toEqual({
      schemaVersion: 19,
      episodes: [
        {
          pages: [
            {
              panels: [
                { id: 'a', camera: 'long' },
                { id: 'b', camera: 'low_angle' },
                { id: 'c', note: '目元のアップ\nレンズ越しの目' },
                { id: 'd', note: 'ロング、俯瞰気味' },
                { id: 'e' },
                { id: 'f', note: 'n' },
              ],
            },
          ],
        },
      ],
    })
  })

  test('migrate rejects unknown, newer or missing versions and non-objects', () => {
    expect(() => migrate({ schemaVersion: 20 })).toThrow()
    expect(() => migrate({ schemaVersion: 0 })).toThrow()
    expect(() => migrate({})).toThrow()
    expect(() => migrate(null)).toThrow()
    expect(() => migrate([])).toThrow()
  })
}
