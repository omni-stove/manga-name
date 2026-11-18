import { basename, extname } from 'node:path'
import { parseArgs } from 'node:util'
import { MAX_PAGE_COUNT, missingLines, parsePageCount, planRequest } from '@manga/ai'
import { m } from '@manga/i18n'
import { createEmptyProject, type Episode, type PageTemplate, type Project } from '@manga/schema'
import { type ApiAuth, type ApiClient, type CloudProject, createApiClient } from './api'
import {
  type Credentials,
  readCredentials,
  removeCredentials,
  writeCredentials,
} from './credentials'
import { plannedEpisode, TEMPLATES } from './draft'
import { login } from './login'
import { openRoom } from './room'

/** run が外の世界に触れる口。テストでは偽物を渡す */
export interface CliIo {
  env: NodeJS.ProcessEnv
  stdout(text: string): void
  stderr(text: string): void
  readFile(path: string): Promise<string>
  readStdin(): Promise<string>
  credentialsPath: string
  openUrl(url: string): void
  fetch: typeof fetch
  /** 共同編集の WebSocket。既定は `new WebSocket(url)` */
  createSocket?: (url: string) => WebSocket
}

/** 使い方の誤り。終了コード 2 で使い方と一緒に出す */
class UsageError extends Error {}

/** parseArgs が知らないオプションなどで throw したもの。`ERR_PARSE_ARGS_` で始まる code を持つ */
const isParseArgsError = (e: unknown): e is Error =>
  e instanceof Error && String((e as { code?: unknown }).code).startsWith('ERR_PARSE_ARGS_')

const DEFAULT_TEMPLATE: PageTemplate = '3rows'

const usage = () => m.cli_usage({ templates: TEMPLATES.join('|') })

/**
 * `manga` コマンド。argv はコマンド名以降の引数で、終了コードを返す（0 成功、1 失敗、2 使い方の誤り）。
 *
 * - `login`: ブラウザでログインし、接続先とセッショントークンを io.credentialsPath に保存する
 * - `logout`: サーバのセッションを消し（届かなくても続ける）、保存した資格情報を消す
 * - `projects`: `GET /v1/projects` を id、ロール、名前の行で stdout に書く
 * - `plan`: プロットのテキストを `POST /v1/ai/plan-pages` でページ割りし、Web の「脚本から下書き」と同じ形の
 *   ページの話にする。`--project`（id か、1 件に決まる名前）があれば、そのプロジェクトの共同編集の部屋につないで
 *   キャラクターを話し手に使い、末尾に話を足す（既定の名前は「第{n}話」）。viewer と commenter のプロジェクトは断る。
 *   無ければ `POST /v1/projects` で新しいプロジェクトを作り、その 1 話として `PUT` する。どちらも同じユーザーで
 *   ログインしたアプリに出る。どのページにも入らなかったセリフは stderr に並べる。
 *   `--dry-run` は送らず、足した後のプロジェクトの JSON を stdout に書く
 *
 * 接続先は `--api`、`MANGA_API_URL`、保存した資格情報の順、認証は `MANGA_DEBUG_USER`、`MANGA_TOKEN`、保存した資格情報の順に使う
 */
export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const [command, ...rest] = argv
    switch (command) {
      case 'login':
        await runLogin(rest, io)
        return 0
      case 'logout':
        await runLogout(io)
        return 0
      case 'projects':
        await runProjects(io)
        return 0
      case 'plan':
        await runPlan(rest, io)
        return 0
      case undefined:
      case '-h':
      case '--help':
      case 'help':
        io.stdout(`${usage()}\n`)
        return command === undefined ? 2 : 0
      default:
        throw new UsageError(m.cli_unknown_command({ command }))
    }
  } catch (e) {
    if (e instanceof UsageError || isParseArgsError(e)) {
      io.stderr(`${e.message}\n\n${usage()}\n`)
      return 2
    }
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n`)
    return 1
  }
}

async function runLogin(args: readonly string[], io: CliIo) {
  const { values } = parseArgs({
    args: [...args],
    options: { api: { type: 'string' }, invite: { type: 'string' } },
  })
  const saved = await readCredentials(io.credentialsPath)
  const apiUrl = values.api ?? io.env.MANGA_API_URL ?? saved?.apiUrl
  if (!apiUrl) throw new UsageError(m.cli_api_url_required())
  const token = await login({
    apiUrl,
    ...(values.invite !== undefined && { invite: values.invite }),
    openUrl: (url) => {
      io.stderr(`${m.cli_login_open({ url })}\n`)
      io.openUrl(url)
    },
    fetch: io.fetch,
  })
  await writeCredentials(io.credentialsPath, { apiUrl, token })
  io.stderr(`${m.cli_login_done({ apiUrl })}\n`)
}

async function runLogout(io: CliIo) {
  const saved = await readCredentials(io.credentialsPath)
  if (saved) {
    try {
      await clientOf(saved.apiUrl, { token: saved.token }, io).signOut()
    } catch {
      // サーバに届かなくても手元のトークンは捨てる。サーバのセッションは期限で切れる
    }
  }
  await removeCredentials(io.credentialsPath)
  io.stderr(`${m.cli_logout_done()}\n`)
}

async function runProjects(io: CliIo) {
  const projects = await (await connect(undefined, io)).listProjects()
  if (projects.length === 0) io.stderr(`${m.cli_projects_empty()}\n`)
  for (const p of projects) io.stdout(`${p.id}\t${p.role}\t${p.title}\n`)
}

async function runPlan(args: readonly string[], io: CliIo) {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      project: { type: 'string' },
      title: { type: 'string' },
      pages: { type: 'string' },
      tone: { type: 'string', default: '' },
      template: { type: 'string', default: DEFAULT_TEMPLATE },
      'episode-title': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      api: { type: 'string' },
    },
  })
  const [file] = positionals
  if (file === undefined || positionals.length > 1) throw new UsageError(m.cli_plan_file_required())
  const pageCount = parsePageCount(values.pages ?? '')
  if (pageCount === null) {
    throw new UsageError(m.cli_plan_page_count_invalid({ max: MAX_PAGE_COUNT }))
  }
  const template = TEMPLATES.find((t) => t === values.template)
  if (template === undefined) {
    throw new UsageError(m.cli_plan_template_invalid({ templates: TEMPLATES.join(', ') }))
  }

  const script = file === '-' ? await io.readStdin() : await io.readFile(file)
  if (script.trim() === '') throw new Error(m.cli_plan_empty())
  const client = await connect(values.api, io)
  const dryRun = values['dry-run']

  /** project の設定とキャラクターでページ割りし、末尾に足す話を作る */
  const draftEpisode = async (project: Project): Promise<Episode> => {
    io.stderr(`${m.cli_plan_planning()}\n`)
    const plans = await client.planPages(
      planRequest(project, {
        script,
        tone: values.tone,
        ...(pageCount !== undefined && { pageCount }),
      }),
    )
    const missing = missingLines(script, plans)
    if (missing.length > 0) {
      io.stderr(`${m.cli_plan_missing({ count: missing.length })}\n`)
      for (const line of missing) io.stderr(`  「${line}」\n`)
    }
    const title =
      values['episode-title']?.trim() ||
      m.web_episode_default_title({ number: project.episodes.length + 1 })
    return plannedEpisode(project, plans, template, title)
  }
  const withEpisode = (project: Project, episode: Episode): Project => ({
    ...project,
    episodes: [...project.episodes, episode],
  })

  if (values.project !== undefined) {
    const target = findProject(await client.listProjects(), values.project)
    if (target.role !== 'owner' && target.role !== 'editor') {
      throw new Error(m.cli_project_read_only({ title: target.title, role: target.role }))
    }
    const room = await openRoom({
      url: () => client.syncUrl(target.id),
      initial: await client.getProject(target.id),
      ...(io.createSocket && { createSocket: io.createSocket }),
    })
    try {
      const episode = await draftEpisode(room.project())
      // ページ割りを待つ間に届いた他の人の変更の上に足す
      const project = room.project()
      if (dryRun) {
        io.stdout(`${JSON.stringify(withEpisode(project, episode), null, 2)}\n`)
        return
      }
      await room.appendEpisode(episode)
      io.stderr(
        `${m.cli_plan_appended({ title: project.title, episode: episode.title, pages: episode.pages.length, id: episode.id })}\n`,
      )
      io.stdout(`${episode.id}\n`)
    } finally {
      room.close()
    }
    return
  }

  const title =
    values.title?.trim() || (file === '-' ? m.untitled() : basename(file, extname(file)))
  // 空のプロジェクトと同じ設定でページ割りする。先に作ると、ページ割りに失敗したとき空のプロジェクトが残る
  const draft = createEmptyProject(title)
  const episode = await draftEpisode(draft)
  if (dryRun) {
    io.stdout(`${JSON.stringify(withEpisode(draft, episode), null, 2)}\n`)
    return
  }
  const created = await client.createProject(title)
  const project = withEpisode(created.project, episode)
  await client.putProject(project, created.etag)
  io.stderr(`${m.cli_plan_registered({ title, pages: episode.pages.length, id: project.id })}\n`)
  io.stdout(`${project.id}\n`)
}

/** id が query のプロジェクト、無ければ名前が query の 1 件。見つからないか名前が重なれば throw する */
function findProject(projects: readonly CloudProject[], query: string): CloudProject {
  const byId = projects.find((p) => p.id === query)
  if (byId) return byId
  const byTitle = projects.filter((p) => p.title === query)
  if (byTitle.length === 1) return byTitle[0] as CloudProject
  throw new Error(
    byTitle.length === 0
      ? m.cli_project_not_found({ project: query })
      : m.cli_project_ambiguous({ project: query, count: byTitle.length }),
  )
}

/** 接続先と認証を決めて ApiClient を作る。決まらなければ throw する */
async function connect(apiFlag: string | undefined, io: CliIo): Promise<ApiClient> {
  const saved: Credentials | null = await readCredentials(io.credentialsPath)
  const apiUrl = apiFlag ?? io.env.MANGA_API_URL ?? saved?.apiUrl
  if (!apiUrl) throw new UsageError(m.cli_api_url_required())
  const token = io.env.MANGA_TOKEN ?? saved?.token
  const auth: ApiAuth | undefined = io.env.MANGA_DEBUG_USER
    ? { debugUser: io.env.MANGA_DEBUG_USER }
    : token
      ? { token }
      : undefined
  if (auth === undefined) throw new Error(m.cli_not_signed_in())
  return clientOf(apiUrl, auth, io)
}

const clientOf = (baseUrl: string, auth: ApiAuth, io: CliIo) =>
  createApiClient({ baseUrl, auth, fetch: io.fetch })

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { aiFixtures } = await import('@manga/ai')
  const { createFakeSyncServer, PROJECT_ROOT, writeYMap } = await import('@manga/collab')
  const { createEmptyProject, fixtures, parseProject } = await import('@manga/schema')

  const SCRIPT = 'E「……ここか」\nE「待って」'

  /** workers/api にある、キャラクター E のいるプロジェクト */
  const existing = { ...fixtures.samplePage01, id: 'prj_cloud', title: '既存' }
  const rows = [
    { id: 'prj_cloud', title: '既存', updatedAt: existing.updatedAt, role: 'editor' },
    { id: 'prj_view', title: '見るだけ', updatedAt: existing.updatedAt, role: 'viewer' },
    { id: 'prj_a', title: '同名', updatedAt: existing.updatedAt, role: 'owner' },
    { id: 'prj_b', title: '同名', updatedAt: existing.updatedAt, role: 'owner' },
  ]

  /** 応答を path ごとに決める偽の workers/api と同期サーバ、出力を貯める io */
  async function setup(env: NodeJS.ProcessEnv = {}) {
    const server = createFakeSyncServer()
    const out: string[] = []
    const err: string[] = []
    const requests: { method: string; path: string; headers: Headers; body: unknown }[] = []
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const { pathname } = new URL(url)
      const body = init.body ? JSON.parse(init.body as string) : undefined
      requests.push({
        method: init.method ?? 'GET',
        path: pathname,
        headers: new Headers(init.headers),
        body,
      })
      if (pathname === '/v1/ai/plan-pages') return Response.json(aiFixtures.pagePlan)
      if (pathname === '/v1/projects' && init.method === 'GET')
        return Response.json({ projects: rows })
      if (pathname === '/v1/projects/prj_cloud') return Response.json(existing)
      if (pathname.endsWith('/sync-ticket')) return Response.json({ ticket: 'tk' })
      if (pathname === '/v1/projects') {
        return Response.json(createEmptyProject(body.title), {
          status: 201,
          headers: { etag: '"v1"' },
        })
      }
      return Response.json({})
    })
    const io: CliIo = {
      env,
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      readFile: async (path) => (path === 'plot.txt' ? SCRIPT : ''),
      readStdin: async () => SCRIPT,
      credentialsPath: join(await mkdtemp(join(tmpdir(), 'manga-cli-')), 'credentials.json'),
      openUrl: () => {},
      fetch: fetchMock as typeof fetch,
      createSocket: server.createSocket,
    }
    return { io, out, err, requests, server }
  }

  describe('plan', () => {
    test('plans the plot and registers it as a new project with one episode', async () => {
      const { io, out, err, requests } = await setup()
      await writeCredentials(io.credentialsPath, { apiUrl: 'https://api.test', token: 'tok' })
      expect(await run(['plan', 'plot.txt', '--pages', '2', '--tone', '静か'], io)).toBe(0)

      expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        'POST /v1/ai/plan-pages',
        'POST /v1/projects',
        expect.stringMatching(/^PUT \/v1\/projects\//),
      ])
      expect(requests[0]?.headers.get('authorization')).toBe('Bearer tok')
      expect(requests[0]?.body).toMatchObject({
        pageCount: 2,
        script: `（全体のトーン: 静か）\n${SCRIPT}`,
      })
      expect(requests[1]?.body).toEqual({ title: 'plot' })
      expect(requests[2]?.headers.get('if-match')).toBe('"v1"')
      const project = parseProject(requests[2]?.body)
      expect(project.title).toBe('plot')
      expect(project.episodes.map((e) => [e.title, e.pages.length])).toEqual([
        [m.web_episode_default_title({ number: 1 }), aiFixtures.pagePlan.length],
      ])
      expect(out.join('')).toBe(`${project.id}\n`)
      expect(err.join('')).toContain('「待って」')
    })

    test('--project adds the episode to the project in the room, with its characters as speakers', async () => {
      const { io, out, err, requests, server } = await setup({
        MANGA_API_URL: 'http://api.test',
        MANGA_TOKEN: 't',
      })
      writeYMap(server.doc.getMap(PROJECT_ROOT), existing as unknown as Record<string, unknown>)
      expect(await run(['plan', 'plot.txt', '--project', '既存'], io)).toBe(0)

      expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        'GET /v1/projects',
        'GET /v1/projects/prj_cloud',
        'POST /v1/projects/prj_cloud/sync-ticket',
        'POST /v1/ai/plan-pages',
        // 届いたかを確かめる接続
        'POST /v1/projects/prj_cloud/sync-ticket',
      ])
      expect(requests[3]?.body).toMatchObject({ project: { characters: existing.characters } })
      const project = parseProject(server.doc.getMap(PROJECT_ROOT).toJSON())
      const added = project.episodes.at(-1)
      expect(project.episodes).toHaveLength(existing.episodes.length + 1)
      expect(added?.title).toBe(
        m.web_episode_default_title({ number: existing.episodes.length + 1 }),
      )
      expect(added?.pages[0]?.cast).toEqual(['chr_e'])
      expect(out.join('')).toBe(`${added?.id}\n`)
      expect(err.join('')).toContain('既存')
      expect(server.connections).toBe(0)
    })

    test('--project with --dry-run sends nothing to the room', async () => {
      const { io, out, server } = await setup({
        MANGA_API_URL: 'http://api.test',
        MANGA_TOKEN: 't',
      })
      const args = [
        'plan',
        'plot.txt',
        '--project',
        'prj_cloud',
        '--dry-run',
        '--episode-title',
        '番外編',
      ]
      expect(await run(args, io)).toBe(0)
      const project = parseProject(JSON.parse(out.join('')))
      expect(project.episodes.at(-1)?.title).toBe('番外編')
      expect(server.doc.getMap(PROJECT_ROOT).size).toBe(0)
    })

    test('--project refuses a missing, ambiguous or read-only project', async () => {
      const { io, err } = await setup({ MANGA_API_URL: 'http://api.test', MANGA_TOKEN: 't' })
      for (const project of ['nope', '同名', '見るだけ']) {
        expect(await run(['plan', 'plot.txt', '--project', project], io)).toBe(1)
      }
      expect(err.join('')).toContain(m.cli_project_not_found({ project: 'nope' }))
      expect(err.join('')).toContain(m.cli_project_ambiguous({ project: '同名', count: 2 }))
      expect(err.join('')).toContain(m.cli_project_read_only({ title: '見るだけ', role: 'viewer' }))
    })

    test('--dry-run writes the project to stdout without registering it', async () => {
      const { io, out, requests } = await setup({
        MANGA_API_URL: 'http://localhost:8787',
        MANGA_DEBUG_USER: 'alice',
      })
      const args = ['plan', '-', '--dry-run', '--title', 'T', '--template', 'blank']
      expect(await run(args, io)).toBe(0)
      expect(requests.map((r) => r.path)).toEqual(['/v1/ai/plan-pages'])
      expect(requests[0]?.headers.get('x-debug-user')).toBe('alice')
      const project = parseProject(JSON.parse(out.join('')))
      expect(project.title).toBe('T')
      expect(project.episodes[0]?.pages[0]?.panels).toEqual([])
    })

    test('usage errors exit with 2 before calling the API', async () => {
      const { io, requests } = await setup({ MANGA_API_URL: 'http://api.test', MANGA_TOKEN: 't' })
      for (const args of [
        ['plan'],
        ['plan', 'a', 'b'],
        ['plan', 'plot.txt', '--pages', '0'],
        ['plan', 'plot.txt', '--template', '9rows'],
        ['plan', 'plot.txt', '--nope'],
        ['nope'],
        [],
      ]) {
        expect(await run(args, io)).toBe(2)
      }
      expect(requests).toEqual([])
    })

    test('fails without a plot, an API URL or a sign-in', async () => {
      const { io, err } = await setup({ MANGA_API_URL: 'http://api.test', MANGA_TOKEN: 't' })
      expect(await run(['plan', 'empty.txt'], io)).toBe(1)
      expect(err.join('')).toContain(m.cli_plan_empty())

      const noUrl = await setup()
      expect(await run(['plan', 'plot.txt'], noUrl.io)).toBe(2)
      const noToken = await setup({ MANGA_API_URL: 'x' })
      expect(await run(['plan', 'plot.txt'], noToken.io)).toBe(1)
      expect(noToken.err.join('')).toContain(m.cli_not_signed_in())
    })
  })

  test('login saves the API URL and token, and logout signs out and removes them', async () => {
    const { io, requests } = await setup()
    io.openUrl = (url) => {
      const port = new URL(url).searchParams.get('port')
      void globalThis.fetch(`http://127.0.0.1:${port}/?token=ott`)
    }
    io.fetch = (async (url: string, init: RequestInit) => {
      requests.push({
        method: init.method ?? 'GET',
        path: new URL(url).pathname,
        headers: new Headers(init.headers),
        body: undefined,
      })
      return Response.json({ session: { token: 'session' } })
    }) as typeof fetch
    expect(await run(['login', '--api', 'https://api.test'], io)).toBe(0)
    expect(await readCredentials(io.credentialsPath)).toEqual({
      apiUrl: 'https://api.test',
      token: 'session',
    })
    expect(await run(['logout'], io)).toBe(0)
    expect(requests.at(-1)).toMatchObject({ path: '/v1/auth/sign-out' })
    expect(requests.at(-1)?.headers.get('authorization')).toBe('Bearer session')
    expect(await readCredentials(io.credentialsPath)).toBeNull()
  })

  test('projects lists the id, role and title', async () => {
    const { io, out } = await setup({ MANGA_API_URL: 'http://api.test', MANGA_TOKEN: 't' })
    expect(await run(['projects'], io)).toBe(0)
    expect(out[0]).toBe('prj_cloud\teditor\t既存\n')
  })

  test('help prints the usage', async () => {
    const { io, out } = await setup()
    expect(await run(['--help'], io)).toBe(0)
    expect(out.join('')).toContain('manga')
  })
}
