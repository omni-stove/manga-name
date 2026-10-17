import { env } from 'cloudflare:workers'
import { fixtures, type Project } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import {
  canEdit,
  changesOnlyScribbles,
  type ProjectRole,
  projectRole,
  updateAllowed,
} from '../src/access'

const stroke = { id: 'st_1', points: [{ x: 0.1, y: 0.2 }], width: 2, color: 'red' as const }

function withScribble(project: Project): Project {
  const next = structuredClone(project)
  next.episodes[0]?.pages[0]?.scribbles.push(stroke)
  return next
}

describe('canEdit', () => {
  test('is true only for owner and editor', () => {
    expect(canEdit('owner')).toBe(true)
    expect(canEdit('editor')).toBe(true)
    expect(canEdit('commenter')).toBe(false)
    expect(canEdit('viewer')).toBe(false)
  })
})

describe('changesOnlyScribbles', () => {
  const project = fixtures.samplePage01
  const saved = JSON.stringify(project)

  test('true when only scribbles and updatedAt change', () => {
    expect(changesOnlyScribbles(saved, project)).toBe(true)
    expect(changesOnlyScribbles(saved, withScribble(project))).toBe(true)
    expect(
      changesOnlyScribbles(saved, {
        ...withScribble(project),
        updatedAt: '2030-01-01T00:00:00.000Z',
      }),
    ).toBe(true)
  })

  test('true when existing scribbles are removed', () => {
    const before = JSON.stringify(withScribble(project))
    expect(changesOnlyScribbles(before, project)).toBe(true)
  })

  test('false when anything besides scribbles changes', () => {
    expect(changesOnlyScribbles(saved, { ...withScribble(project), title: 'changed' })).toBe(false)

    const moved = withScribble(project)
    const panel = moved.episodes[0]?.pages[0]?.panels[0]
    if (!panel) throw new Error('fixture has no panel')
    panel.rect = { ...panel.rect, h: 0.2 }
    expect(changesOnlyScribbles(saved, moved)).toBe(false)

    const added = structuredClone(project)
    added.episodes[0]?.pages.push({ id: 'pg_new', side: 'single', panels: [], scribbles: [] })
    expect(changesOnlyScribbles(saved, added)).toBe(false)
  })

  test('false when the saved JSON is not a valid project', () => {
    expect(changesOnlyScribbles('{', project)).toBe(false)
    expect(changesOnlyScribbles(JSON.stringify({ schemaVersion: 1 }), project)).toBe(false)
  })
})

describe('projectRole', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM projects'),
      env.DB.prepare('DELETE FROM users'),
      env.DB.prepare("INSERT INTO users (id, created_at) VALUES ('alice', 0), ('bob', 0)"),
      env.DB.prepare(
        `INSERT INTO projects (id, owner_id, title, updated_at, rev)
         VALUES ('p1', 'alice', 't', '2026-01-01T00:00:00.000Z', 'r'),
                ('p2', 'bob', 't', '2026-01-01T00:00:00.000Z', 'r')`,
      ),
      env.DB.prepare(
        `INSERT INTO project_members (project_id, user_id, role, created_at)
         VALUES ('p1', 'ed', 'editor', 0), ('p1', 'co', 'commenter', 0), ('p1', 'vi', 'viewer', 0)`,
      ),
    ])
  })

  test('owner from projects.owner_id, others from project_members', async () => {
    expect(await projectRole(env.DB, 'alice', 'p1')).toBe('owner')
    expect(await projectRole(env.DB, 'ed', 'p1')).toBe('editor')
    expect(await projectRole(env.DB, 'co', 'p1')).toBe('commenter')
    expect(await projectRole(env.DB, 'vi', 'p1')).toBe('viewer')
  })

  test('null for a non-member, a member of another project and a missing project', async () => {
    expect(await projectRole(env.DB, 'bob', 'p1')).toBeNull()
    expect(await projectRole(env.DB, 'ed', 'p2')).toBeNull()
    expect(await projectRole(env.DB, 'alice', 'missing')).toBeNull()
  })
})

describe('updateAllowed', () => {
  /** apps/web と同じく、ルートの Y.Map `project` に episodes / pages / scribbles を入れ子にした doc */
  function projectDoc() {
    const doc = new Y.Doc()
    const root = doc.getMap<unknown>('project')
    doc.transact(() => {
      root.set('title', 't')
      root.set('updatedAt', '2026-01-01T00:00:00.000Z')
      const page = new Y.Map<unknown>()
      page.set('id', 'pg_1')
      page.set('panels', Y.Array.from([new Y.Map([['id', 'pn_1']])]))
      const scribble = new Y.Map<unknown>()
      scribble.set('id', 'st_0')
      scribble.set('width', 1)
      page.set('scribbles', Y.Array.from([scribble]))
      const episode = new Y.Map<unknown>()
      episode.set('pages', Y.Array.from([page]))
      root.set('episodes', Y.Array.from([episode]))
    })
    return doc
  }

  const pageOf = (doc: Y.Doc) => {
    const episodes = doc.getMap('project').get('episodes') as Y.Array<Y.Map<unknown>>
    return (episodes.get(0).get('pages') as Y.Array<Y.Map<unknown>>).get(0)
  }
  const scribblesOf = (doc: Y.Doc) => pageOf(doc).get('scribbles') as Y.Array<Y.Map<unknown>>

  /** doc を写したクライアントで change を 1 トランザクションで行い、その更新を返す */
  function updateOf(doc: Y.Doc, change: (client: Y.Doc) => void) {
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(doc))
    const before = Y.encodeStateVector(client)
    client.transact(() => change(client))
    return Y.encodeStateAsUpdate(client, before)
  }

  const addStroke = (client: Y.Doc) => {
    scribblesOf(client).push([new Y.Map<unknown>([['id', 'st_1']])])
  }

  test('owner and editor may change anything', () => {
    const doc = projectDoc()
    const update = updateOf(doc, (c) => c.getMap('project').set('title', 'x'))
    for (const role of ['owner', 'editor'] satisfies ProjectRole[]) {
      expect(updateAllowed(doc, update, role)).toBe(true)
    }
  })

  test('a commenter may change the scribbles of a page, with the root updatedAt', () => {
    const doc = projectDoc()
    expect(updateAllowed(doc, updateOf(doc, addStroke), 'commenter')).toBe(true)
    expect(
      updateAllowed(
        doc,
        updateOf(doc, (c) => {
          addStroke(c)
          c.getMap('project').set('updatedAt', '2026-02-01T00:00:00.000Z')
        }),
        'commenter',
      ),
      'with updatedAt',
    ).toBe(true)
    expect(
      updateAllowed(
        doc,
        updateOf(doc, (c) => scribblesOf(c).get(0).set('width', 3)),
        'commenter',
      ),
      'inside a stroke',
    ).toBe(true)
    expect(
      updateAllowed(
        doc,
        updateOf(doc, (c) => scribblesOf(c).delete(0, 1)),
        'commenter',
      ),
      'removing a stroke',
    ).toBe(true)
  })

  test('a commenter may not change anything outside the scribbles', () => {
    const doc = projectDoc()
    const denied: [string, (c: Y.Doc) => void][] = [
      ['title', (c) => c.getMap('project').set('title', 'x')],
      [
        'updatedAt with another root key',
        (c) => {
          c.getMap('project').set('updatedAt', '2026-02-01T00:00:00.000Z')
          c.getMap('project').set('title', 'x')
        },
      ],
      [
        'scribbles with a panel',
        (c) => {
          addStroke(c)
          ;(pageOf(c).get('panels') as Y.Array<unknown>).delete(0, 1)
        },
      ],
      ['replacing the scribbles array', (c) => pageOf(c).set('scribbles', new Y.Array())],
      ['another root type', (c) => c.getArray('log').push([1])],
    ]
    for (const [name, change] of denied) {
      expect(updateAllowed(doc, updateOf(doc, change), 'commenter'), name).toBe(false)
    }
  })

  test('a viewer may not change anything, but an empty update passes', () => {
    const doc = projectDoc()
    expect(updateAllowed(doc, updateOf(doc, addStroke), 'viewer')).toBe(false)
    expect(
      updateAllowed(
        doc,
        updateOf(doc, () => {}),
        'viewer',
      ),
    ).toBe(true)
  })

  test('false for an update whose dependencies the doc lacks', () => {
    const doc = projectDoc()
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(doc))
    addStroke(client)
    const afterStroke = Y.encodeStateVector(client)
    scribblesOf(client).get(1).set('width', 2)
    const dependent = Y.encodeStateAsUpdate(client, afterStroke)
    expect(updateAllowed(doc, dependent, 'commenter')).toBe(false)
  })

  test('does not change the doc', () => {
    const doc = projectDoc()
    const before = Y.encodeStateAsUpdate(doc)
    expect(updateAllowed(doc, updateOf(doc, addStroke), 'commenter')).toBe(true)
    expect(
      updateAllowed(
        doc,
        updateOf(doc, (c) => c.getMap('project').set('title', 'x')),
        'commenter',
      ),
    ).toBe(false)
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
    expect(scribblesOf(doc).length).toBe(1)
  })
})
