import { m } from '@manga/i18n'
import { type ID, type PageSlot, type Project, pageSlots } from '@manga/schema'
import { Link, type LinkProps } from '@tanstack/react-router'
import styles from './breadcrumb.module.css'

/** パンくずの 1 項目。`link` は途中の項目から移る先 */
export interface Crumb {
  label: string
  link?: Pick<LinkProps, 'to' | 'params'>
}

/** プロジェクト配下の画面。パンくずの末尾をどこまで伸ばすかを決める */
export type ProjectScreen =
  | { kind: 'episodes' }
  | { kind: 'episode'; episodeId: ID }
  | { kind: 'draft'; episodeId: ID }
  | { kind: 'characters' }
  | { kind: 'newCharacter' }
  | { kind: 'page'; pageId: ID }

/**
 * 作品名から screen までのパンくず。題は project から引くので、名前の変更や共同編集の更新を渡し直せば表記も変わる。
 * 開いている間にエピソードやページが消えたときは、その段を総称の名前にする
 */
export function projectTrail(project: Project, projectId: ID, screen: ProjectScreen): Crumb[] {
  const root: Crumb = {
    label: project.title || m.untitled(),
    link: { to: '/p/$projectId', params: { projectId } },
  }
  const episodeCrumb = (episodeId: ID): Crumb => ({
    label:
      project.episodes.find((e) => e.id === episodeId)?.title ?? m.web_draft_episode_fallback(),
    link: { to: '/p/$projectId/episodes/$episodeId', params: { projectId, episodeId } },
  })
  const characters: Crumb = {
    label: m.web_characters_title(),
    link: { to: '/p/$projectId/characters', params: { projectId } },
  }
  switch (screen.kind) {
    case 'episodes':
      return [root]
    case 'episode':
      return [root, episodeCrumb(screen.episodeId)]
    case 'draft':
      return [root, episodeCrumb(screen.episodeId), { label: m.web_draft_title() }]
    case 'characters':
      return [root, characters]
    case 'newCharacter':
      return [root, characters, { label: m.web_characters_add() }]
    case 'page': {
      for (const episode of project.episodes) {
        const slot = pageSlots(episode).find((s) => s.page.id === screen.pageId)
        if (slot) return [root, episodeCrumb(episode.id), { label: slotLabel(slot) }]
      }
      return [root, { label: m.page() }]
    }
  }
}

/** ページのノンブル。見開きは 2 つのノンブルを並べる */
export function slotLabel({ number, side }: PageSlot): string {
  return side === 'spread'
    ? m.web_episode_spread_number({ from: number, to: number + 1 })
    : m.web_episode_page_number({ number })
}

/**
 * 今いる画面までの道筋。最後の項目は今の画面なのでリンクにせず aria-current を付ける。
 * 区切りの › は読み上げない
 */
export function Breadcrumb({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label={m.web_breadcrumb()}>
      <ol className={styles.list}>
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: 項目は階層の深さで決まり、同じ深さの項目は入れ替わらない
            <li key={i} className={styles.item}>
              {i > 0 && <span aria-hidden>›</span>}
              {last || !item.link ? (
                <span
                  className={last ? styles.current : undefined}
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link {...item.link} className={styles.link}>
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')

  const project = fixtures.samplePage01
  const projectId = project.id
  const episode = project.episodes[0]
  if (!episode) throw new Error('fixture has no episode')
  const page = episode.pages[0]
  if (!page) throw new Error('fixture has no page')
  const labels = (screen: ProjectScreen, p: Project = project) =>
    projectTrail(p, projectId, screen).map((c) => c.label)

  describe('projectTrail', () => {
    test('作品名から今の画面まで並ぶ', () => {
      expect(labels({ kind: 'episodes' })).toEqual([project.title])
      expect(labels({ kind: 'episode', episodeId: episode.id })).toEqual([
        project.title,
        episode.title,
      ])
      expect(labels({ kind: 'draft', episodeId: episode.id })).toEqual([
        project.title,
        episode.title,
        m.web_draft_title(),
      ])
      expect(labels({ kind: 'characters' })).toEqual([project.title, m.web_characters_title()])
      expect(labels({ kind: 'newCharacter' })).toEqual([
        project.title,
        m.web_characters_title(),
        m.web_characters_add(),
      ])
      expect(labels({ kind: 'page', pageId: page.id })).toEqual([
        project.title,
        episode.title,
        m.web_episode_page_number({ number: 1 }),
      ])
    })

    test('途中の項目はその画面へのリンクになる', () => {
      const [root, ep] = projectTrail(project, projectId, { kind: 'draft', episodeId: episode.id })
      expect(root?.link).toEqual({ to: '/p/$projectId', params: { projectId } })
      expect(ep?.link).toEqual({
        to: '/p/$projectId/episodes/$episodeId',
        params: { projectId, episodeId: episode.id },
      })
    })

    test('題を変えた project を渡すと表記も変わり、空の作品名は無題にする', () => {
      const renamed: Project = {
        ...project,
        title: '',
        episodes: [{ ...episode, title: '改題' }, ...project.episodes.slice(1)],
      }
      expect(labels({ kind: 'episode', episodeId: episode.id }, renamed)).toEqual([
        m.untitled(),
        '改題',
      ])
    })

    test('消えたエピソードとページは総称で出す', () => {
      expect(labels({ kind: 'episode', episodeId: 'nope' })).toEqual([
        project.title,
        m.web_draft_episode_fallback(),
      ])
      expect(labels({ kind: 'page', pageId: 'nope' })).toEqual([project.title, m.page()])
    })
  })
}
