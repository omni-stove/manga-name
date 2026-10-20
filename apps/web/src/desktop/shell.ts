import { m } from '@manga/i18n'
import type { ID, Project } from '@manga/schema'
import { emit } from '@tauri-apps/api/event'
import { Menu, type MenuItemOptions, type PredefinedMenuItemOptions } from '@tauri-apps/api/menu'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import {
  exportFileName,
  exportProjectJson,
  PROJECT_FILE_FILTERS,
  parseProjectFile,
} from '../project-file'
import type { ProjectLibrary } from '../project-library'
import { errorMessage } from '../route-error'
import type { createAppRouter } from '../router'
import { toasts } from '../toasts'
import { isEditable } from '../use-undo-shortcuts'
import { startFileDrop } from './file-drop'
import {
  loadRecentFiles,
  pushRecent,
  type RecentFile,
  recentLabel,
  saveRecentFiles,
} from './recent-files'
import { EDIT_EVENT, openScriptWindow } from './windows'

export interface DesktopShellOptions {
  router: ReturnType<typeof createAppRouter>
  library: ProjectLibrary
}

type MenuEntry = MenuItemOptions | PredefinedMenuItemOptions
const predefined = (item: PredefinedMenuItemOptions['item']): PredefinedMenuItemOptions => ({
  item,
})
const separator = predefined('Separator')

/**
 * Desktop のアプリメニュー（ファイル、編集、表示）を張り、ファイルを開く・保存するダイアログと最近開いたファイルをつなぐ。
 * 開くは `.manga.json` をライブラリに読み込んで開き、保存は開いているプロジェクトを JSON でそのファイルに書く。
 * ウィンドウに落とした `.manga.json` も開くと同じく開く（startFileDrop）。
 * 編集の Undo / Redo はページの編集画面のときだけ、そのプロジェクトの store に送る。
 * 表示の「脚本を別ウィンドウで開く」は、開いているエピソード（ページの編集画面ならそのページを含むエピソード）の脚本の画面を別のウィンドウで開く。
 * ウィンドウの位置と大きさは Rust 側の window-state プラグインが戻す
 */
export async function startDesktopShell({ router, library }: DesktopShellOptions): Promise<void> {
  const isMac = navigator.userAgent.includes('Mac')
  let recent = await loadRecentFiles()

  const run = (failure: (reason: string) => string, task: () => Promise<void>) => () => {
    task().catch((e: unknown) => toasts.push(failure(errorMessage(e))))
  }

  // メニューは別ウィンドウ（脚本）にも付くが、ここの router と library はこのウィンドウのもの。フォーカスのないときの操作で、このウィンドウの状態を書いたり開いたりしない
  const whenFocused = (task: () => Promise<void>) => async () => {
    if (document.hasFocus()) await task()
  }

  const currentProjectId = (): ID | undefined => {
    for (const match of router.state.matches) {
      const { projectId } = match.params as { projectId?: ID }
      if (projectId) return projectId
    }
  }

  const command = async (name: 'undo' | 'redo') => {
    // アプリメニューは別ウィンドウ（脚本）にも付き、accelerator はここに届く。フォーカスのないこのウィンドウの store は触らず、フォーカスのあるウィンドウへ event で渡す
    if (!document.hasFocus()) {
      await emit(EDIT_EVENT, name)
      return
    }
    // メニューの accelerator が Cmd+Z を取るので、入力欄の中では入力欄自身の取り消しを呼び直す
    if (isEditable(document.activeElement)) {
      document.execCommand(name)
      return
    }
    // Undo はページの編集画面だけのもの。他の画面では削除を確認ダイアログで確かめる
    const page = router.state.matches.find(
      (match) => match.routeId === '/p/$projectId_/pages/$pageId',
    )
    const id = (page?.params as { projectId?: ID } | undefined)?.projectId
    const store = id ? await library.open(id) : undefined
    if (name === 'undo') store?.undo()
    else store?.redo()
  }

  const remember = async (file: RecentFile) => {
    recent = pushRecent(recent, file)
    await saveRecentFiles(recent)
    await rebuildMenu()
  }

  // 前に開いたプロジェクトがライブラリに残っていれば、自動保存されたそちらを開く。ファイルは最後の保存の時点で止まっている
  const openPath = async (path: string) => {
    const known = recent.find((f) => f.path === path)?.projectId
    let id: ID
    if (known && (await library.open(known))) {
      id = known
    } else {
      const project = parseProjectFile(await readTextFile(path))
      const listed = (await library.list()).some((p) => p.id === project.id)
      id = listed ? project.id : (await library.import(project)).id
    }
    await remember({ path, projectId: id })
    await router.navigate({ to: '/p/$projectId', params: { projectId: id } })
  }

  const openDialog = async () => {
    const path = await open({ multiple: false, directory: false, filters: PROJECT_FILE_FILTERS })
    if (path !== null) await openPath(path)
  }

  const writeProject = async (path: string, project: Project) => {
    await writeTextFile(path, exportProjectJson(project))
    await remember({ path, projectId: project.id })
  }

  const currentProject = async () => {
    const id = currentProjectId()
    return (id ? await library.open(id) : undefined)?.get()
  }

  const saveAs = async () => {
    const project = await currentProject()
    if (!project) return
    const path = await save({ defaultPath: exportFileName(project), filters: PROJECT_FILE_FILTERS })
    if (path !== null) await writeProject(path, project)
  }

  const saveCurrent = async () => {
    const project = await currentProject()
    if (!project) return
    const path = recent.find((f) => f.projectId === project.id)?.path
    if (path) await writeProject(path, project)
    else await saveAs()
  }

  const recentItems = (): MenuEntry[] => {
    if (recent.length === 0) return [{ text: m.web_menu_recent_none(), enabled: false }]
    return [
      ...recent.map((f) => ({
        text: recentLabel(f.path),
        action: run(
          (reason) => m.web_menu_open_failed({ reason }),
          whenFocused(() => openPath(f.path)),
        ),
      })),
      separator,
      {
        text: m.web_menu_clear_recent(),
        action: run(
          (reason) => m.web_menu_clear_recent_failed({ reason }),
          async () => {
            recent = []
            await saveRecentFiles(recent)
            await rebuildMenu()
          },
        ),
      },
    ]
  }

  // ページの編集画面からはそのページを含むエピソードの脚本を開き、横に並べて書ける
  const currentEpisodeId = async (): Promise<ID | undefined> => {
    for (const match of router.state.matches) {
      const { episodeId, pageId } = match.params as { episodeId?: ID; pageId?: ID }
      if (episodeId) return episodeId
      if (!pageId) continue
      const project = await currentProject()
      return project?.episodes.find((e) => e.pages.some((p) => p.id === pageId))?.id
    }
  }

  const openScript = async () => {
    const projectId = currentProjectId()
    const episodeId = await currentEpisodeId()
    if (!projectId || !episodeId) {
      toasts.push(m.web_menu_script_window_no_episode())
      return
    }
    const { href } = router.buildLocation({
      to: '/p/$projectId/episodes/$episodeId/draft',
      params: { projectId, episodeId },
    })
    await openScriptWindow({ projectId, episodeId, url: href, title: m.web_draft_title() })
  }

  const openSettings = () =>
    void router.navigate({
      to: '.',
      search: (prev) => ({ ...prev, settings: 'app' }),
      replace: true,
    })

  // 最近開いたファイルが変わるたびに作り直す。項目を 1 つずつ差し替えるより IPC の往復が少ない
  const rebuildMenu = async () => {
    const menu = await Menu.new({
      items: [
        ...(isMac
          ? [
              {
                text: 'Manga Name',
                items: [
                  predefined({ About: null }),
                  separator,
                  predefined('Services'),
                  separator,
                  predefined('Hide'),
                  predefined('HideOthers'),
                  predefined('ShowAll'),
                  separator,
                  predefined('Quit'),
                ],
              },
            ]
          : []),
        {
          text: m.web_menu_file(),
          items: [
            {
              text: m.web_menu_open(),
              accelerator: 'CmdOrCtrl+O',
              action: run((reason) => m.web_menu_open_failed({ reason }), whenFocused(openDialog)),
            },
            { text: m.web_menu_recent(), items: recentItems() },
            separator,
            {
              text: m.save(),
              accelerator: 'CmdOrCtrl+S',
              action: run((reason) => m.web_menu_save_failed({ reason }), whenFocused(saveCurrent)),
            },
            {
              text: m.web_menu_save_as(),
              accelerator: 'CmdOrCtrl+Shift+S',
              action: run((reason) => m.web_menu_save_failed({ reason }), whenFocused(saveAs)),
            },
            separator,
            isMac ? predefined('CloseWindow') : predefined('Quit'),
          ],
        },
        {
          text: m.web_menu_edit(),
          items: [
            {
              text: m.web_menu_undo(),
              accelerator: 'CmdOrCtrl+Z',
              action: run(
                (reason) => m.web_menu_undo_failed({ reason }),
                () => command('undo'),
              ),
            },
            {
              text: m.web_menu_redo(),
              accelerator: isMac ? 'CmdOrCtrl+Shift+Z' : 'CmdOrCtrl+Y',
              action: run(
                (reason) => m.web_menu_redo_failed({ reason }),
                () => command('redo'),
              ),
            },
            separator,
            predefined('Cut'),
            predefined('Copy'),
            predefined('Paste'),
            predefined('SelectAll'),
          ],
        },
        {
          text: m.web_menu_view(),
          items: [
            {
              text: m.web_project_list(),
              action: () => {
                if (document.hasFocus()) void router.navigate({ to: '/' })
              },
            },
            {
              text: m.web_app_settings(),
              accelerator: 'CmdOrCtrl+,',
              action: () => {
                if (document.hasFocus()) openSettings()
              },
            },
            separator,
            {
              text: m.web_menu_script_window(),
              action: run((reason) => m.web_menu_script_window_failed({ reason }), openScript),
            },
            ...(isMac ? [separator, predefined('Fullscreen'), predefined('Minimize')] : []),
          ],
        },
      ],
    })
    await menu.setAsAppMenu()
  }

  await rebuildMenu()
  await startFileDrop(openPath)
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest
  const { createEmptyProject } = await import('@manga/schema')
  const { createFakeStoreIpc, installFakeTauri } = await import('./fake-tauri')

  afterEach(() => {
    vi.unstubAllGlobals()
    toasts.state.setState({ toasts: [] })
  })

  interface SentItem {
    text?: string
    accelerator?: string
    item?: unknown
    items?: SentItem[]
    handler?: { onmessage: (id: string) => void }
  }

  class FakeElement {
    constructor(
      readonly tagName: string,
      readonly isContentEditable = false,
    ) {}
  }

  const setup = async ({
    userAgent = 'Windows',
    recent = [] as RecentFile[],
    files = {} as Record<string, string>,
    dialogPath = null as string | null,
    libraryProjects = [] as Project[],
    currentId = undefined as ID | undefined,
    onPage = false,
    pageId = 'page' as ID,
  } = {}) => {
    const store = createFakeStoreIpc({ recentFiles: recent })
    const written = new Map<string, string>()
    let menu: SentItem[] = []
    const dialogs: { cmd: string; options: unknown }[] = []
    const createdWindows: unknown[] = []
    const listeners = new Map<string, number>()
    const tauri = installFakeTauri(vi.stubGlobal, (cmd, args, options) => {
      if (cmd.startsWith('plugin:store|')) return store.handle(cmd, args)
      switch (cmd) {
        case 'plugin:window|get_all_windows':
        case 'plugin:webview|get_all_webviews':
          return []
        case 'plugin:webview|create_webview_window':
          createdWindows.push((args as { options: unknown }).options)
          return null
        case 'plugin:event|listen': {
          const { event, handler } = args as { event: string; handler: number }
          listeners.set(event, handler)
          return handler
        }
        case 'plugin:event|emit':
        case 'plugin:event|unlisten':
          return null
        case 'plugin:menu|new':
          menu = (args as { options: { items: SentItem[] } }).options.items
          return [1, 'menu']
        case 'plugin:menu|set_as_app_menu':
          return null
        case 'plugin:dialog|open':
        case 'plugin:dialog|save':
          dialogs.push({ cmd, options: (args as { options: unknown }).options })
          return dialogPath
        case 'plugin:fs|read_text_file': {
          const text = files[(args as { path: string }).path]
          if (text === undefined) throw new Error('no such file')
          return [...new TextEncoder().encode(text)]
        }
        case 'plugin:fs|write_text_file':
          written.set(
            decodeURIComponent(options?.headers?.path ?? ''),
            new TextDecoder().decode(args as Uint8Array),
          )
          return null
        default:
          throw new Error(`unexpected IPC ${cmd}`)
      }
    })
    vi.stubGlobal('navigator', { userAgent })
    vi.stubGlobal('HTMLElement', FakeElement)
    const execCommand = vi.fn()
    vi.stubGlobal('document', { activeElement: null, execCommand, hasFocus: () => true })

    const stores = new Map(
      libraryProjects.map((p) => [p.id, { get: () => p, undo: vi.fn(), redo: vi.fn() }]),
    )
    const library = {
      open: vi.fn(async (id: ID) => stores.get(id)),
      list: vi.fn(async () => libraryProjects),
      import: vi.fn(async (p: Project) => ({ ...p, id: 'imported' })),
    }
    const router = {
      state: {
        matches: [
          { routeId: '__root__', params: {} },
          {
            routeId: onPage ? '/p/$projectId_/pages/$pageId' : '/p/$projectId',
            params: { projectId: currentId, ...(onPage && { pageId }) },
          },
        ],
      },
      navigate: vi.fn(async () => {}),
      buildLocation: ({ params }: { params: { projectId: ID; episodeId: ID } }) => ({
        href: `/p/${params.projectId}/episodes/${params.episodeId}/draft`,
      }),
    }
    await startDesktopShell({
      router: router as unknown as DesktopShellOptions['router'],
      library: library as unknown as ProjectLibrary,
    })

    const find = (path: string[], items = menu): SentItem => {
      const [head, ...rest] = path
      const found = items.find((i) => i.text === head)
      if (!found) throw new Error(`no menu item ${head}`)
      return rest.length === 0 ? found : find(rest, found.items)
    }
    const click = (...path: string[]) => find(path).handler?.onmessage('id')
    const drop = (...paths: string[]) =>
      tauri.callback(listeners.get('tauri://drag-drop') ?? -1)?.({
        event: 'tauri://drag-drop',
        id: 1,
        payload: { paths, position: { x: 0, y: 0 } },
      })
    return {
      store,
      written,
      dialogs,
      createdWindows,
      library,
      router,
      stores,
      execCommand,
      find,
      click,
      drop,
      menuTexts: () => menu.map((i) => i.text),
    }
  }

  const fileProject = createEmptyProject('ファイルの作品')

  describe('startDesktopShell', () => {
    test('sets the File, Edit and View menus, with no recent files yet', async () => {
      const shell = await setup()
      expect(shell.menuTexts()).toEqual([m.web_menu_file(), m.web_menu_edit(), m.web_menu_view()])
      expect(shell.find([m.web_menu_file(), m.web_menu_recent()]).items).toEqual([
        { text: m.web_menu_recent_none(), enabled: false },
      ])
      expect(shell.find([m.web_menu_edit(), m.web_menu_redo()]).accelerator).toBe('CmdOrCtrl+Y')
    })

    test('on a Mac it adds the app menu and uses Shift+Cmd+Z to redo', async () => {
      const shell = await setup({ userAgent: 'Macintosh; Intel Mac OS X' })
      expect(shell.menuTexts()).toEqual([
        'Manga Name',
        m.web_menu_file(),
        m.web_menu_edit(),
        m.web_menu_view(),
      ])
      expect(shell.find([m.web_menu_edit(), m.web_menu_redo()]).accelerator).toBe(
        'CmdOrCtrl+Shift+Z',
      )
    })

    test('opening a new file imports it, remembers it and opens the project', async () => {
      const shell = await setup({
        dialogPath: '/w/a.manga.json',
        files: { '/w/a.manga.json': exportProjectJson(fileProject) },
      })
      shell.click(m.web_menu_file(), m.web_menu_open())
      await vi.waitFor(() => expect(shell.router.navigate).toHaveBeenCalled())
      expect(shell.library.import).toHaveBeenCalledExactlyOnceWith(fileProject)
      expect(shell.router.navigate).toHaveBeenCalledWith({
        to: '/p/$projectId',
        params: { projectId: 'imported' },
      })
      expect(shell.store.values.get('recentFiles')).toEqual([
        { path: '/w/a.manga.json', projectId: 'imported' },
      ])
      expect(shell.find([m.web_menu_file(), m.web_menu_recent(), 'a.manga.json'])).toBeDefined()
    })

    test('a file whose project is already in the library is not imported again', async () => {
      const shell = await setup({
        dialogPath: '/w/a.manga.json',
        files: { '/w/a.manga.json': exportProjectJson(fileProject) },
        libraryProjects: [fileProject],
      })
      shell.click(m.web_menu_file(), m.web_menu_open())
      await vi.waitFor(() => expect(shell.router.navigate).toHaveBeenCalled())
      expect(shell.library.import).not.toHaveBeenCalled()
      expect(shell.router.navigate).toHaveBeenCalledWith({
        to: '/p/$projectId',
        params: { projectId: fileProject.id },
      })
    })

    test('a recent file opens the autosaved project without reading the file', async () => {
      const shell = await setup({
        recent: [{ path: '/w/a.manga.json', projectId: fileProject.id }],
        libraryProjects: [fileProject],
      })
      shell.click(m.web_menu_file(), m.web_menu_recent(), 'a.manga.json')
      await vi.waitFor(() => expect(shell.router.navigate).toHaveBeenCalled())
      expect(shell.library.list).not.toHaveBeenCalled()
    })

    test('a file that cannot be opened shows a toast', async () => {
      const shell = await setup({
        dialogPath: '/w/broken.json',
        files: { '/w/broken.json': '{' },
      })
      shell.click(m.web_menu_file(), m.web_menu_open())
      await vi.waitFor(() => expect(toasts.state.getState().toasts).toHaveLength(1))
      expect(toasts.state.getState().toasts[0]?.message).toBe(
        m.web_menu_open_failed({ reason: m.web_project_file_invalid_json() }),
      )
      expect(shell.router.navigate).not.toHaveBeenCalled()
    })

    test('a project file dropped on the window is imported, remembered and opened', async () => {
      const shell = await setup({ files: { '/w/a.manga.json': exportProjectJson(fileProject) } })
      shell.drop('/w/a.manga.json')
      await vi.waitFor(() => expect(shell.router.navigate).toHaveBeenCalled())
      expect(shell.library.import).toHaveBeenCalledExactlyOnceWith(fileProject)
      expect(shell.router.navigate).toHaveBeenCalledWith({
        to: '/p/$projectId',
        params: { projectId: 'imported' },
      })
      expect(shell.store.values.get('recentFiles')).toEqual([
        { path: '/w/a.manga.json', projectId: 'imported' },
      ])
      expect(shell.dialogs).toEqual([])
    })

    test('save writes the open project to the file it came from', async () => {
      const shell = await setup({
        recent: [{ path: '/w/a.manga.json', projectId: fileProject.id }],
        libraryProjects: [fileProject],
        currentId: fileProject.id,
      })
      shell.click(m.web_menu_file(), m.save())
      await vi.waitFor(() => expect(shell.written.size).toBe(1))
      expect(shell.written.get('/w/a.manga.json')).toBe(exportProjectJson(fileProject))
      expect(shell.dialogs).toEqual([])
    })

    test('save without a file asks where to save, and a closed dialog writes nothing', async () => {
      const shell = await setup({ libraryProjects: [fileProject], currentId: fileProject.id })
      shell.click(m.web_menu_file(), m.save())
      await vi.waitFor(() => expect(shell.dialogs).toHaveLength(1))
      expect(shell.dialogs[0]).toEqual({
        cmd: 'plugin:dialog|save',
        options: { defaultPath: 'ファイルの作品.manga.json', filters: PROJECT_FILE_FILTERS },
      })
      expect(shell.written.size).toBe(0)
    })

    test('save as writes to the chosen path and remembers it', async () => {
      const shell = await setup({
        dialogPath: '/w/b.manga.json',
        libraryProjects: [fileProject],
        currentId: fileProject.id,
      })
      shell.click(m.web_menu_file(), m.web_menu_save_as())
      await vi.waitFor(() =>
        expect(shell.store.values.get('recentFiles')).toEqual([
          { path: '/w/b.manga.json', projectId: fileProject.id },
        ]),
      )
      expect(shell.written.has('/w/b.manga.json')).toBe(true)
    })

    test('save does nothing outside a project', async () => {
      const shell = await setup({ dialogPath: '/w/b.manga.json' })
      shell.click(m.web_menu_file(), m.web_menu_save_as())
      await vi.waitFor(() => expect(shell.library.open).not.toHaveBeenCalled())
      expect(shell.dialogs).toEqual([])
    })

    test('undo and redo go to the project of the open page, or to the focused text field', async () => {
      const shell = await setup({
        libraryProjects: [fileProject],
        currentId: fileProject.id,
        onPage: true,
      })
      const store = shell.stores.get(fileProject.id)
      shell.click(m.web_menu_edit(), m.web_menu_undo())
      await vi.waitFor(() => expect(store?.undo).toHaveBeenCalledOnce())
      shell.click(m.web_menu_edit(), m.web_menu_redo())
      await vi.waitFor(() => expect(store?.redo).toHaveBeenCalledOnce())

      vi.stubGlobal('document', {
        activeElement: new FakeElement('INPUT'),
        execCommand: shell.execCommand,
        hasFocus: () => true,
      })
      shell.click(m.web_menu_edit(), m.web_menu_undo())
      await vi.waitFor(() => expect(shell.execCommand).toHaveBeenCalledWith('undo'))
      expect(store?.undo).toHaveBeenCalledOnce()
    })

    test('undo does nothing outside the page editor', async () => {
      const shell = await setup({ libraryProjects: [fileProject], currentId: fileProject.id })
      shell.click(m.web_menu_edit(), m.web_menu_undo())
      await vi.waitFor(() => expect(shell.library.open).not.toHaveBeenCalled())
      expect(shell.stores.get(fileProject.id)?.undo).not.toHaveBeenCalled()
    })

    test('clearing the history empties the recent files', async () => {
      const shell = await setup({ recent: [{ path: '/w/a.manga.json', projectId: 'p' }] })
      shell.click(m.web_menu_file(), m.web_menu_recent(), m.web_menu_clear_recent())
      await vi.waitFor(() => expect(shell.store.values.get('recentFiles')).toEqual([]))
      await vi.waitFor(() =>
        expect(shell.find([m.web_menu_file(), m.web_menu_recent()]).items).toEqual([
          { text: m.web_menu_recent_none(), enabled: false },
        ]),
      )
    })

    test('the View menu navigates to the project list and opens the settings over the current screen', async () => {
      const shell = await setup()
      shell.click(m.web_menu_view(), m.web_project_list())
      shell.click(m.web_menu_view(), m.web_app_settings())
      const [[list], [settings]] = shell.router.navigate.mock.calls as unknown as [
        [unknown],
        [{ search(prev: object): object }],
      ]
      expect(list).toEqual({ to: '/' })
      expect(settings).toMatchObject({ to: '.', replace: true })
      expect(settings.search({ q: 1 })).toEqual({ q: 1, settings: 'app' })
    })

    test('from the page editor the View menu opens the script of the episode of that page in a new window', async () => {
      const project = {
        ...fileProject,
        episodes: [{ id: 'ep', pages: [{ id: 'page' }] }],
      } as unknown as Project
      const shell = await setup({ libraryProjects: [project], currentId: project.id, onPage: true })
      shell.click(m.web_menu_view(), m.web_menu_script_window())
      await vi.waitFor(() => expect(shell.createdWindows).toHaveLength(1))
      expect(shell.createdWindows[0]).toMatchObject({
        label: `script-${project.id}-ep`,
        url: `/p/${project.id}/episodes/ep/draft`,
      })
    })

    test('the script window needs an open episode', async () => {
      const shell = await setup({ libraryProjects: [fileProject], currentId: fileProject.id })
      shell.click(m.web_menu_view(), m.web_menu_script_window())
      await vi.waitFor(() => expect(toasts.state.getState().toasts).toHaveLength(1))
      expect(shell.createdWindows).toEqual([])
    })
  })
}
