import { SCHEMA_VERSION } from './project'

/** v13 から v31 までの Panel.camera の値。v32 で角度を Panel.angle に分けた */
type CameraV13 = 'long' | 'middle' | 'bust' | 'close_up' | 'low_angle' | 'high_angle'

/** v12 まで画面の候補として出していた呼び名 */
const CAMERA_NAMES: Record<string, CameraV13> = {
  ロング: 'long',
  ミドル: 'middle',
  バストアップ: 'bust',
  アップ: 'close_up',
  アオリ: 'low_angle',
  あおり: 'low_angle',
  俯瞰: 'high_angle',
}

/** v31 の Panel.camera のうち角度の値と、それに当たる v32 の Panel.angle */
const CAMERA_ANGLES: Record<string, 'low' | 'high'> = { low_angle: 'low', high_angle: 'high' }

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

/** v31 の角度の Panel.camera を v32 の Panel.angle に移して camera を消す。寄りの値はそのまま残す */
function cameraToAngle(panel: Json): Json {
  const { camera, ...rest } = panel
  if (typeof camera !== 'string' || !Object.hasOwn(CAMERA_ANGLES, camera)) return panel
  return { ...rest, angle: CAMERA_ANGLES[camera] }
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
  // v24 は Bubble.typeface の hand を足しただけ。版を上げる理由は v6 と同じ
  23: (json) => ({ ...json, schemaVersion: 24 }),
  // v25 は Panel.scene と Panel.beat を足しただけ。版を上げる理由は v2 と同じ
  24: (json) => ({ ...json, schemaVersion: 25 }),
  // v26 は Bubble.writing を足しただけ。版を上げる理由は v2 と同じ
  25: (json) => ({ ...json, schemaVersion: 26 }),
  // v27 は Panel.effect の beta_flash を足しただけ。版を上げる理由は v6 と同じ
  26: (json) => ({ ...json, schemaVersion: 27 }),
  // v28 は Bubble.joinedTo を足しただけ。版を上げる理由は v2 と同じ
  27: (json) => ({ ...json, schemaVersion: 28 }),
  // v29 は FocusPoint の rotation、typeface、scale を足しただけ。版を上げる理由は v2 と同じ
  28: (json) => ({ ...json, schemaVersion: 29 }),
  // v30 は Stroke.pressure を足しただけ。版を上げる理由は v2 と同じ
  29: (json) => ({ ...json, schemaVersion: 30 }),
  // v31 は Panel.noArt を足しただけ。版を上げる理由は v2 と同じ
  30: (json) => ({ ...json, schemaVersion: 31 }),
  // v32 は Panel.camera の角度（low_angle、high_angle）を Panel.angle に分けた
  31: (json) => ({ ...json, schemaVersion: 32, episodes: mapPanels(json, cameraToAngle) }),
  // v33 は Panel.camera・Panel.angle・Panel.effect・Bubble.shape・FocusPoint.kind の値と、FocusPoint.mark、
  // Page.hashira を足しただけ。版を上げる理由は v6 と同じ
  32: (json) => ({ ...json, schemaVersion: 33 }),
  // v34 は Panel.breakout を足しただけ。版を上げる理由は v2 と同じ
  33: (json) => ({ ...json, schemaVersion: 34 }),
  // v35 は Page.fills を足しただけ。版を上げる理由は v2 と同じ
  34: (json) => ({ ...json, schemaVersion: 35 }),
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

  test('migrate v35 → v35 is a no-op', () => {
    const json = { schemaVersion: 35, title: 't' }
    expect(migrate(json)).toBe(json)
  })

  test('migrate v1 → v35 only bumps the version of a project without cameras', () => {
    expect(migrate({ schemaVersion: 1, title: 't' })).toEqual({ schemaVersion: 35, title: 't' })
  })

  test('migrate v17 → v35 only bumps the version of bubbles without a tail and leaves them white', () => {
    const bubbles = [{ id: 'bb', shape: 'normal' }]
    const json = { schemaVersion: 17, episodes: [{ pages: [{ panels: [{ bubbles }] }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 35 })
  })

  test('migrate v18 → v35 only bumps the version and leaves the panels without an effect', () => {
    const panels = [{ id: 'a', frame: 'cloud', camera: 'long' }]
    const json = { schemaVersion: 18, episodes: [{ pages: [{ overlay: 'gray', panels }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 35 })
  })

  test('migrate v19 → v35 turns the single tail into the first of the tails', () => {
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
      schemaVersion: 35,
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

  test('migrate v20 → v35 only bumps the version and leaves the panels without acting', () => {
    const panels = [{ id: 'a', note: 'n', cast: ['chr_a'] }]
    expect(migrate({ schemaVersion: 20, episodes: [{ pages: [{ panels }] }] })).toEqual({
      schemaVersion: 35,
      episodes: [{ pages: [{ panels }] }],
    })
  })

  test('migrate v21 → v35 keeps the page tone and leaves the panels without a tone', () => {
    const pages = [{ tone: 'sepia', panels: [{ id: 'a', frame: 'cloud' }] }]
    const json = { schemaVersion: 21, episodes: [{ pages }] }
    expect(migrate(json)).toEqual({ schemaVersion: 35, episodes: [{ pages }] })
  })

  test('migrate v22 → v35 only bumps the version and keeps the bubble shapes', () => {
    const bubbles = [
      { id: 'a', shape: 'narration' },
      { id: 'b', shape: 'thought' },
    ]
    const json = { schemaVersion: 22, episodes: [{ pages: [{ panels: [{ bubbles }] }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 35 })
  })

  test('migrate v23 → v35 only bumps the version and keeps the typefaces of the bubbles', () => {
    const bubbles = [
      { id: 'bb_1', shape: 'narration' },
      { id: 'bb_2', shape: 'normal', typeface: 'rounded' },
    ]
    const json = { schemaVersion: 23, episodes: [{ pages: [{ panels: [{ bubbles }] }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 35 })
  })

  test('migrate v24 → v35 only bumps the version and gives the panels no scene or beat', () => {
    const panels = [{ id: 'pn', note: 'n' }]
    const json = { schemaVersion: 24, episodes: [{ pages: [{ panels }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 35 })
  })

  test('migrate v25 → v35 only bumps the version and leaves the dialogue vertical', () => {
    const bubbles = [{ id: 'bb', shape: 'normal', text: 'あ' }]
    const json = { schemaVersion: 25, episodes: [{ pages: [{ panels: [{ bubbles }] }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 35 })
  })

  test('migrate v26 → v35 only bumps the version and keeps the effects of the panels', () => {
    const panels = [
      { id: 'pn_1', effect: 'focus_lines' },
      { id: 'pn_2', effect: 'speed_lines', fill: 'black' },
      { id: 'pn_3' },
    ]
    const json = { schemaVersion: 26, episodes: [{ pages: [{ panels }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 35 })
  })

  test('migrate v27 → v35 only bumps the version and leaves the bubbles unjoined', () => {
    const bubbles = [
      { id: 'bb_1', order: 1, tails: [{ x: 0.1, y: 0.9 }] },
      { id: 'bb_2', order: 2 },
    ]
    const json = { schemaVersion: 27, episodes: [{ pages: [{ panels: [{ bubbles }] }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 35 })
  })

  test('migrate v28 → v35 only bumps the version and keeps sfx focus points as the default lettering', () => {
    const focusPoints = [
      { id: 'fp', kind: 'sfx', label: 'ドン', pos: { x: 0.5, y: 0.5 }, weight: 1 },
    ]
    const json = { schemaVersion: 28, episodes: [{ pages: [{ panels: [{ focusPoints }] }] }] }
    const migrated = migrate(json)
    expect(migrated).toEqual({ ...json, schemaVersion: 35 })
    const focus = ['episodes', 0, 'pages', 0, 'panels', 0, 'focusPoints', 0]
    for (const key of ['rotation', 'typeface', 'scale']) {
      expect(migrated).not.toHaveProperty([...focus, key])
    }
  })

  test('migrate v29 → v35 only bumps the version and leaves the scribbles without pressure', () => {
    const scribbles = [{ id: 'st', points: [{ x: 0.1, y: 0.2 }], width: 2, color: 'ink' }]
    const json = { schemaVersion: 29, episodes: [{ pages: [{ scribbles }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 35 })
  })

  test('migrate v30 → v35 only bumps the version and leaves every panel with art', () => {
    const panels = [{ id: 'pn', bubbles: [], arts: [] }]
    const json = { schemaVersion: 30, episodes: [{ pages: [{ panels }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 35 })
  })

  test('migrate v31 → v35 moves the angles of the camera to the angle and keeps the shot sizes', () => {
    const panels = [
      { id: 'a', camera: 'low_angle', note: 'n' },
      { id: 'b', camera: 'high_angle' },
      { id: 'c', camera: 'bust' },
      { id: 'd' },
      'broken',
    ]
    const json = { schemaVersion: 31, episodes: [{ pages: [{ panels }] }] }
    const migrated = migrate(json)
    expect(migrated).toEqual({
      schemaVersion: 35,
      episodes: [
        {
          pages: [
            {
              panels: [
                { id: 'a', angle: 'low', note: 'n' },
                { id: 'b', angle: 'high' },
                { id: 'c', camera: 'bust' },
                { id: 'd' },
                'broken',
              ],
            },
          ],
        },
      ],
    })
    expect(migrated).not.toHaveProperty(['episodes', 0, 'pages', 0, 'panels', 0, 'camera'])
  })

  test('migrate v32 → v35 only bumps the version and keeps the cameras, angles, effects, shapes and focus points', () => {
    const focusPoints = [
      { id: 'fp', kind: 'sfx', label: 'ドン', pos: { x: 0.5, y: 0.5 }, weight: 1 },
    ]
    const panels = [
      { id: 'pn', camera: 'close_up', angle: 'low', effect: 'speed_lines', focusPoints },
      { id: 'pn_2', bubbles: [{ id: 'bb', shape: 'shout' }] },
    ]
    const json = { schemaVersion: 32, episodes: [{ pages: [{ panels }] }] }
    const migrated = migrate(json)
    expect(migrated).toEqual({ ...json, schemaVersion: 35 })
    expect(migrated).not.toHaveProperty(['episodes', 0, 'pages', 0, 'hashira'])
  })

  test('migrate v33 → v35 only bumps the version and keeps the art inside the panels', () => {
    const json = { schemaVersion: 33, episodes: [{ pages: [{ panels: [{ id: 'pn' }] }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 35 })
  })

  test('migrate v34 → v35 only bumps the version and leaves the pages without fills', () => {
    const json = { schemaVersion: 34, episodes: [{ pages: [{ panels: [], scribbles: [] }] }] }
    expect(migrate(json)).toEqual({ ...json, schemaVersion: 35 })
  })

  test('migrate v12 → v35 turns the suggested camera names into values and moves the rest to the note', () => {
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
      schemaVersion: 35,
      episodes: [
        {
          pages: [
            {
              panels: [
                { id: 'a', camera: 'long' },
                { id: 'b', angle: 'low' },
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
    expect(() => migrate({ schemaVersion: 36 })).toThrow()
    expect(() => migrate({ schemaVersion: 0 })).toThrow()
    expect(() => migrate({})).toThrow()
    expect(() => migrate(null)).toThrow()
    expect(() => migrate([])).toThrow()
  })
}
