// @vitest-environment jsdom
import { useCallback, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

const KEY = 'manga.theme'

const isPreference = (v: unknown): v is ThemePreference =>
  v === 'system' || v === 'light' || v === 'dark'

/** 保存したテーマ。無い、読めない、壊れているときは system */
export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return isPreference(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

/**
 * テーマを `<html data-theme>` に当てて保存する。system は属性を外し、OS の設定に従わせる。
 * 初回描画の前に `applyThemePreference(readThemePreference())` を呼ぶと、ちらつかない
 */
export function applyThemePreference(pref: ThemePreference) {
  const root = document.documentElement
  if (pref === 'system') delete root.dataset.theme
  else root.dataset.theme = pref
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    // 保存できない環境でも、このタブの間は切り替わる
  }
}

/** テーマの選択欄用。選ぶとすぐ当てて保存する */
export function useThemePreference() {
  const [pref, setPref] = useState(readThemePreference)
  const set = useCallback((next: ThemePreference) => {
    applyThemePreference(next)
    setPref(next)
  }, [])
  return [pref, set] as const
}

if (import.meta.vitest) {
  const { afterEach, expect, test } = import.meta.vitest

  afterEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  test('applying a theme sets data-theme and persists it', () => {
    applyThemePreference('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(readThemePreference()).toBe('dark')
  })

  test('system removes the attribute and the saved value', () => {
    applyThemePreference('light')
    applyThemePreference('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  test('an unknown saved value reads as system', () => {
    localStorage.setItem(KEY, 'sepia')
    expect(readThemePreference()).toBe('system')
  })
}
