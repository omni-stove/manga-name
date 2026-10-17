import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  countMonthlyGenerations,
  monthRange,
  parseMonthlyLimit,
  reserveUsage,
  settleUsage,
} from '../src/usage'

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0)
const MONTH_START = Date.UTC(2026, 9, 1)

async function seed(userId: string, at: number) {
  await env.DB.prepare(
    `INSERT INTO ai_usage (user_id, kind, cost_units, created_at) VALUES (?1, 'panel-art', 1, ?2)`,
  )
    .bind(userId, at)
    .run()
}

const reserve = (monthlyLimit = 100, now = NOW, userId = 'alice') =>
  reserveUsage(env.DB, { userId, kind: 'critique', now, monthlyLimit })

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM ai_usage').run()
})

describe('monthRange', () => {
  test('spans the UTC month containing now', () => {
    expect(monthRange(NOW)).toEqual({ start: MONTH_START, end: Date.UTC(2026, 10, 1) })
    expect(monthRange(MONTH_START)).toEqual({ start: MONTH_START, end: Date.UTC(2026, 10, 1) })
    expect(monthRange(MONTH_START - 1).end).toBe(MONTH_START)
  })

  test('December ends at January of the next year', () => {
    expect(monthRange(Date.UTC(2026, 11, 31, 23, 59, 59))).toEqual({
      start: Date.UTC(2026, 11, 1),
      end: Date.UTC(2027, 0, 1),
    })
  })
})

describe('parseMonthlyLimit', () => {
  test('reads non-negative integers', () => {
    expect(parseMonthlyLimit('0')).toBe(0)
    expect(parseMonthlyLimit('300')).toBe(300)
    expect(parseMonthlyLimit(' 5 ')).toBe(5)
  })

  test('throws on a missing, blank, negative, fractional or unsafe value', () => {
    for (const value of [undefined, '', '  ', '-1', '1.5', 'ten', 'Infinity', '9007199254740992']) {
      expect(() => parseMonthlyLimit(value), String(value)).toThrow(
        'MONTHLY_GENERATION_LIMIT must be a non-negative integer',
      )
    }
  })
})

describe('countMonthlyGenerations', () => {
  test('counts only the user’s rows from the start of the month', async () => {
    await seed('alice', MONTH_START - 1)
    await seed('alice', MONTH_START)
    await seed('alice', NOW)
    await seed('bob', NOW)
    expect(await countMonthlyGenerations(env.DB, 'alice', NOW)).toBe(2)
    expect(await countMonthlyGenerations(env.DB, 'carol', NOW)).toBe(0)
  })
})

describe('reserveUsage', () => {
  test('inserts a row with zero cost and returns its id, which settleUsage updates', async () => {
    const reservation = await reserve()
    if (reservation.status !== 'reserved') throw new Error(reservation.status)
    await settleUsage(env.DB, reservation.id, 2)
    const row = await env.DB.prepare('SELECT * FROM ai_usage WHERE id = ?1')
      .bind(reservation.id)
      .first()
    expect(row).toEqual({
      id: reservation.id,
      user_id: 'alice',
      kind: 'critique',
      cost_units: 2,
      created_at: NOW,
    })
  })

  test('a limit of 0 refuses every generation', async () => {
    expect(await reserve(0)).toEqual({ status: 'monthly-limit' })
  })

  test('the per-minute window excludes a row exactly a minute old', async () => {
    for (let i = 0; i < 10; i++) await seed('alice', NOW - 60_000)
    expect((await reserve()).status).toBe('reserved')
    for (let i = 0; i < 9; i++) await seed('alice', NOW - 59_999)
    expect(await reserve()).toEqual({ status: 'rate-limited' })
  })

  test('the per-minute limit is per user', async () => {
    for (let i = 0; i < 10; i++) await seed('bob', NOW)
    expect((await reserve()).status).toBe('reserved')
    expect(await reserve(100, NOW, 'bob')).toEqual({ status: 'rate-limited' })
  })

  test('rows of the previous month do not count toward the monthly limit', async () => {
    for (let i = 0; i < 3; i++) await seed('alice', MONTH_START - 1)
    expect((await reserve(1, MONTH_START)).status).toBe('reserved')
    expect(await reserve(1, MONTH_START + 1)).toEqual({ status: 'monthly-limit' })
  })
})
