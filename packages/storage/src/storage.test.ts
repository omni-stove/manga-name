import 'fake-indexeddb/auto'
import { createEmptyProject, type Project } from '@manga/schema'
import { describe, expect, test } from 'vitest'
import type { StorageAdapter } from './adapter'
import { createIndexedDbStorage } from './indexeddb'
import { createMemoryStorage } from './memory'

const adapters: [string, () => StorageAdapter][] = [
  ['memory', createMemoryStorage],
  ['indexeddb', () => createIndexedDbStorage(`test-${crypto.randomUUID()}`)],
]

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
const project = (title: string, updatedAt: string): Project => ({
  ...createEmptyProject(title),
  updatedAt,
})

describe.each(adapters)('%s StorageAdapter', (_name, make) => {
  test('save then load round-trips a project', async () => {
    const s = make()
    const p = project('A', '2026-01-01T00:00:00.000Z')
    await s.saveProject(p)
    expect(await s.loadProject(p.id)).toEqual(p)
  })

  test('save overwrites and does not alias the caller object', async () => {
    const s = make()
    const p = project('A', '2026-01-01T00:00:00.000Z')
    await s.saveProject(p)
    p.title = 'mutated'
    expect((await s.loadProject(p.id)).title).toBe('A')
    await s.saveProject({ ...p, title: 'B' })
    expect((await s.loadProject(p.id)).title).toBe('B')
  })

  test('load rejects a missing project', async () => {
    await expect(make().loadProject('nope')).rejects.toThrow(/not found/)
  })

  test('listProjects returns summaries, newest first', async () => {
    const s = make()
    const old = project('old', '2026-01-01T00:00:00.000Z')
    const recent = project('new', '2026-02-01T00:00:00.000Z')
    await s.saveProject(old)
    await s.saveProject(recent)
    expect(await s.listProjects()).toEqual([
      { id: recent.id, title: 'new', updatedAt: recent.updatedAt },
      { id: old.id, title: 'old', updatedAt: old.updatedAt },
    ])
  })

  test('deleteProject removes the project and only its assets', async () => {
    const s = make()
    const a = project('a', '2026-01-01T00:00:00.000Z')
    const b = project('b', '2026-01-01T00:00:00.000Z')
    await s.saveProject(a)
    await s.saveProject(b)
    const refA = await s.putAsset(a.id, png())
    const refB = await s.putAsset(b.id, png())
    await s.deleteProject(a.id)
    await expect(s.loadProject(a.id)).rejects.toThrow()
    await expect(s.loadAsset(refA)).rejects.toThrow(/not found/)
    expect((await s.listProjects()).map((x) => x.id)).toEqual([b.id])
    expect((await s.loadAsset(refB)).size).toBe(4)
  })

  test('deleting a missing project is a no-op', async () => {
    await expect(make().deleteProject('nope')).resolves.toBeUndefined()
  })

  test('putAsset then loadAsset round-trips the bytes', async () => {
    const s = make()
    const ref = await s.putAsset('p', png(), 'panel')
    expect(ref).toMatch(/^blob:.+/)
    const blob = await s.loadAsset(ref)
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([137, 80, 78, 71])
  })

  test('putAsset returns a distinct ref each time', async () => {
    const s = make()
    expect(await s.putAsset('p', png())).not.toBe(await s.putAsset('p', png()))
  })

  test('resolveAsset returns a URL for a stored asset', async () => {
    const s = make()
    const url = await s.resolveAsset(await s.putAsset('p', png()))
    expect(url).toMatch(/^blob:/)
    URL.revokeObjectURL(url)
  })

  test('asset lookups reject unknown and unsupported refs', async () => {
    const s = make()
    await expect(s.loadAsset('blob:missing')).rejects.toThrow(/not found/)
    await expect(s.resolveAsset('blob:missing')).rejects.toThrow(/not found/)
    await expect(s.loadAsset('r2:key')).rejects.toThrow(/Unsupported/)
    await expect(s.loadAsset('blob:')).rejects.toThrow(/Unsupported/)
  })
})

test('indexeddb data survives a new adapter on the same database', async () => {
  const name = `test-${crypto.randomUUID()}`
  const p = project('kept', '2026-01-01T00:00:00.000Z')
  const first = createIndexedDbStorage(name)
  await first.saveProject(p)
  const ref = await first.putAsset(p.id, png())
  const second = createIndexedDbStorage(name)
  expect((await second.loadProject(p.id)).title).toBe('kept')
  expect((await second.loadAsset(ref)).size).toBe(4)
})
