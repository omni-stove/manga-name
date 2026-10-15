// WS-01 が docs/03-data-model.md を Zod に写してここに置く。
// それまでは空パッケージ。scaffold の確認用に 1 つだけ export しておく。
export const SCHEMA_VERSION = 1 as const

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('scaffold: schema package is wired into the workspace', () => {
    expect(SCHEMA_VERSION).toBe(1)
  })
}
