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

/** v19 の 1 本だけの Bubble.tail を v20 の Bubble.tails の 1 本目にする */
function tailToTails(bubble: Json): Json {
  if (!Object.hasOwn(bubble, 'tail')) return bubble
  const { tail, ...rest } = bubble
  return tail === undefined || tail === null ? rest : { ...rest, tails: [tail] }
}

/** 全ページの全コマに fn を当てる */
const mapPanels = (json: Json, fn: (panel: Json) => Json): unknown =>
  mapObjects(json.episodes, (episode) => ({
    ...episode,
    pages: mapObjects(episode.pages, (page) => ({
      ...page,
      panels: mapObjects(page.panels, fn),
    })),
  }))

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
  12: (json) => ({ ...json, schemaVersion: 13, episodes: mapPanels(json, cameraToEnum) }),
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
  // v20 は Bubble.tail を、しっぽを何本も持てる Bubble.tails にした
  19: (json) => ({
    ...json,
    schemaVersion: 20,
    episodes: mapPanels(json, (panel) => ({
      ...panel,
      bubbles: mapObjects(panel.bubbles, tailToTails),
    })),
  }),
  // v21 は Panel.acting を足しただけ。版を上げる理由は v2 と同じ
  20: (json) => ({ ...json, schemaVersion: 21 }),
  // v22 は Panel.tone を足しただけ。版を上げる理由は v6 と同じ
  21: (json) => ({ ...json, schemaVersion: 22 }),
  // v23 は Bubble.shape の monologue を足しただけ。版を上げる理由は v6 と同じ
  22: (json) => ({ ...json, schemaVersion: 23 }),
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

  test('migrate v23 → v23 is a no-op', () => {
    const json = { schemaVersion: 23, title: 't' }
    expect(migrate(json)).toBe(json)
  })

  test('migrate v1 → v23 only bumps the version of a project without cameras', () => {
    expect(migrate({ schemaVersion: 1, title: 't' })).toEqual({ schemaVersion: 23, title: 't' })
  })

  test('migrate v17 → v23 only bumps the version of bubbles without a tail and leaves them white', () => {
    const bubbles = [{ id: 'bb', shape: 'normal' }]
    const json = { schemaVersion: 17, episodes: [{ pages: [{ panels: [{ bubbles }] }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 23 })
  })

  test('migrate v18 → v23 only bumps the version and leaves the panels without an effect', () => {
    const panels = [{ id: 'a', frame: 'cloud', camera: 'long' }]
    const json = { schemaVersion: 18, episodes: [{ pages: [{ overlay: 'gray', panels }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 23 })
  })

  test('migrate v19 → v23 turns the single tail into the first of the tails', () => {
    const bubbles = [
      { id: 'a', tail: { x: 0.1, y: 0.9 } },
      { id: 'b' },
      { id: 'c', tail: null },
      'broken',
    ]
    const panels = [{ id: 'p', bubbles }]
    const json = { schemaVersion: 19, episodes: [{ pages: [{ panels }] }] }
    const migrated = migrate(json)
    expect(migrated).toEqual({
      schemaVersion: 23,
      episodes: [
        {
          pages: [
            {
              panels: [
                {
                  id: 'p',
                  bubbles: [
                    { id: 'a', tails: [{ x: 0.1, y: 0.9 }] },
                    { id: 'b' },
                    { id: 'c' },
                    'broken',
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    const first = ['episodes', 0, 'pages', 0, 'panels', 0, 'bubbles', 0]
    expect(migrated).toHaveProperty([...first, 'tails'])
    expect(migrated).not.toHaveProperty([...first, 'tail'])
  })

  test('migrate v20 → v23 only bumps the version and leaves the panels without acting', () => {
    const panels = [{ id: 'a', note: 'n', cast: ['chr_a'] }]
    expect(migrate({ schemaVersion: 20, episodes: [{ pages: [{ panels }] }] })).toEqual({
      schemaVersion: 23,
      episodes: [{ pages: [{ panels }] }],
    })
  })

  test('migrate v21 → v23 keeps the page tone and leaves the panels without a tone', () => {
    const pages = [{ tone: 'sepia', panels: [{ id: 'a', frame: 'cloud' }] }]
    const json = { schemaVersion: 21, episodes: [{ pages }] }
    expect(migrate(json)).toEqual({ schemaVersion: 23, episodes: [{ pages }] })
  })

  test('migrate v22 → v23 only bumps the version and keeps the bubble shapes', () => {
    const bubbles = [
      { id: 'a', shape: 'narration' },
      { id: 'b', shape: 'thought' },
    ]
    const json = { schemaVersion: 22, episodes: [{ pages: [{ panels: [{ bubbles }] }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 23 })
  })

  test('migrate v12 → v23 turns the suggested camera names into values and moves the rest to the note', () => {
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
      schemaVersion: 23,
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
    expect(() => migrate({ schemaVersion: 24 })).toThrow()
    expect(() => migrate({ schemaVersion: 0 })).toThrow()
    expect(() => migrate({})).toThrow()
    expect(() => migrate(null)).toThrow()
    expect(() => migrate([])).toThrow()
  })
}
