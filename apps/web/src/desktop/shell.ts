import type { ID, Project } from '@manga/schema'
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
import {
  loadRecentFiles,
  pushRecent,
  type RecentFile,
  recentLabel,
  saveRecentFiles,
} from './recent-files'

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
 * 編集の Undo / Redo はページの編集画面のときだけ、そのプロジェクトの store に送る。
 * ウィンドウの位置と大きさは Rust 側の window-state プラグインが戻す
 */
export async function startDesktopShell({ router, library }: DesktopShellOptions): Promise<void> {
  const isMac = navigator.userAgent.includes('Mac')
  let recent = await loadRecentFiles()

  const run = (failure: string, task: () => Promise<void>) => () => {
    task().catch((e: unknown) => toasts.push(`${failure}: ${errorMessage(e)}`))
  }

  const currentProjectId = (): ID | undefined => {
    for (const match of router.state.matches) {
      const { projectId } = match.params as { projectId?: ID }
      if (projectId) return projectId
    }
  }

  const command = async (name: 'undo' | 'redo') => {
    // メニューの accelerator が Cmd+Z を取るので、入力欄の中では入力欄自身の取り消しを呼び直す
    if (isEditable(document.activeElement)) {
      document.execCommand(name)
      return
    }
    // Undo はページの編集画面だけのもの。他の画面では削除を確認ダイアログで確かめる
    const page = router.state.matches.find((m) => m.routeId === '/p/$projectId_/pages/$pageId')
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
    if (recent.length === 0) return [{ text: 'なし', enabled: false }]
    return [
      ...recent.map((f) => ({
        text: recentLabel(f.path),
        action: run('開けません', () => openPath(f.path)),
      })),
      separator,
      {
        text: '履歴を消す',
        action: run('履歴を消せません', async () => {
          recent = []
          await saveRecentFiles(recent)
          await rebuildMenu()
        }),
      },
    ]
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
          text: 'ファイル',
          items: [
            { text: '開く…', accelerator: 'CmdOrCtrl+O', action: run('開けません', openDialog) },
            { text: '最近開いたファイル', items: recentItems() },
            separator,
            {
              text: '保存',
              accelerator: 'CmdOrCtrl+S',
              action: run('保存できません', saveCurrent),
            },
            {
              text: '名前を付けて保存…',
              accelerator: 'CmdOrCtrl+Shift+S',
              action: run('保存できません', saveAs),
            },
            separator,
            isMac ? predefined('CloseWindow') : predefined('Quit'),
          ],
        },
        {
          text: '編集',
          items: [
            {
              text: '取り消す',
              accelerator: 'CmdOrCtrl+Z',
              action: run('取り消せません', () => command('undo')),
            },
            {
              text: 'やり直す',
              accelerator: isMac ? 'CmdOrCtrl+Shift+Z' : 'CmdOrCtrl+Y',
              action: run('やり直せません', () => command('redo')),
            },
            separator,
            predefined('Cut'),
            predefined('Copy'),
            predefined('Paste'),
            predefined('SelectAll'),
          ],
        },
        {
          text: '表示',
          items: [
            { text: 'プロジェクト一覧', action: () => void router.navigate({ to: '/' }) },
            { text: 'アプリ設定', accelerator: 'CmdOrCtrl+,', action: openSettings },
            ...(isMac ? [separator, predefined('Fullscreen'), predefined('Minimize')] : []),
          ],
        },
      ],
    })
    await menu.setAsAppMenu()
  }

  await rebuildMenu()
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
  } = {}) => {
    const store = createFakeStoreIpc({ recentFiles: recent })
    const written = new Map<string, string>()
    let menu: SentItem[] = []
    const dialogs: { cmd: string; options: unknown }[] = []
    installFakeTauri(vi.stubGlobal, (cmd, args, options) => {
      if (cmd.startsWith('plugin:store|')) return store.handle(cmd, args)
      switch (cmd) {
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
    vi.stubGlobal('document', { activeElement: null, execCommand })

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
            params: { projectId: currentId },
          },
        ],
      },
      navigate: vi.fn(async () => {}),
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
    return {
      store,
      written,
      dialogs,
      library,
      router,
      stores,
      execCommand,
      find,
      click,
      menuTexts: () => menu.map((i) => i.text),
    }
  }

  const fileProject = createEmptyProject('ファイルの作品')

  describe('startDesktopShell', () => {
    test('sets the File, Edit and View menus, with no recent files yet', async () => {
      const shell = await setup()
      expect(shell.menuTexts()).toEqual(['ファイル', '編集', '表示'])
      expect(shell.find(['ファイル', '最近開いたファイル']).items).toEqual([
        { text: 'なし', enabled: false },
      ])
      expect(shell.find(['編集', 'やり直す']).accelerator).toBe('CmdOrCtrl+Y')
    })

    test('on a Mac it adds the app menu and uses Shift+Cmd+Z to redo', async () => {
      const shell = await setup({ userAgent: 'Macintosh; Intel Mac OS X' })
      expect(shell.menuTexts()).toEqual(['Manga Name', 'ファイル', '編集', '表示'])
      expect(shell.find(['編集', 'やり直す']).accelerator).toBe('CmdOrCtrl+Shift+Z')
    })

    test('opening a new file imports it, remembers it and opens the project', async () => {
      const shell = await setup({
        dialogPath: '/w/a.manga.json',
        files: { '/w/a.manga.json': exportProjectJson(fileProject) },
      })
      shell.click('ファイル', '開く…')
      await vi.waitFor(() => expect(shell.router.navigate).toHaveBeenCalled())
      expect(shell.library.import).toHaveBeenCalledExactlyOnceWith(fileProject)
      expect(shell.router.navigate).toHaveBeenCalledWith({
        to: '/p/$projectId',
        params: { projectId: 'imported' },
      })
      expect(shell.store.values.get('recentFiles')).toEqual([
        { path: '/w/a.manga.json', projectId: 'imported' },
      ])
      expect(shell.find(['ファイル', '最近開いたファイル', 'a.manga.json'])).toBeDefined()
    })

    test('a file whose project is already in the library is not imported again', async () => {
      const shell = await setup({
        dialogPath: '/w/a.manga.json',
        files: { '/w/a.manga.json': exportProjectJson(fileProject) },
        libraryProjects: [fileProject],
      })
      shell.click('ファイル', '開く…')
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
      shell.click('ファイル', '最近開いたファイル', 'a.manga.json')
      await vi.waitFor(() => expect(shell.router.navigate).toHaveBeenCalled())
      expect(shell.library.list).not.toHaveBeenCalled()
    })

    test('a file that cannot be opened shows a toast', async () => {
      const shell = await setup({
        dialogPath: '/w/broken.json',
        files: { '/w/broken.json': '{' },
      })
      shell.click('ファイル', '開く…')
      await vi.waitFor(() => expect(toasts.state.getState().toasts).toHaveLength(1))
      expect(toasts.state.getState().toasts[0]?.message).toBe('開けません: JSON として読めません')
      expect(shell.router.navigate).not.toHaveBeenCalled()
    })

    test('save writes the open project to the file it came from', async () => {
      const shell = await setup({
        recent: [{ path: '/w/a.manga.json', projectId: fileProject.id }],
        libraryProjects: [fileProject],
        currentId: fileProject.id,
      })
      shell.click('ファイル', '保存')
      await vi.waitFor(() => expect(shell.written.size).toBe(1))
      expect(shell.written.get('/w/a.manga.json')).toBe(exportProjectJson(fileProject))
      expect(shell.dialogs).toEqual([])
    })

    test('save without a file asks where to save, and a closed dialog writes nothing', async () => {
      const shell = await setup({ libraryProjects: [fileProject], currentId: fileProject.id })
      shell.click('ファイル', '保存')
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
      shell.click('ファイル', '名前を付けて保存…')
      await vi.waitFor(() =>
        expect(shell.store.values.get('recentFiles')).toEqual([
          { path: '/w/b.manga.json', projectId: fileProject.id },
        ]),
      )
      expect(shell.written.has('/w/b.manga.json')).toBe(true)
    })

    test('save does nothing outside a project', async () => {
      const shell = await setup({ dialogPath: '/w/b.manga.json' })
      shell.click('ファイル', '名前を付けて保存…')
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
      shell.click('編集', '取り消す')
      await vi.waitFor(() => expect(store?.undo).toHaveBeenCalledOnce())
      shell.click('編集', 'やり直す')
      await vi.waitFor(() => expect(store?.redo).toHaveBeenCalledOnce())

      vi.stubGlobal('document', {
        activeElement: new FakeElement('INPUT'),
        execCommand: shell.execCommand,
      })
      shell.click('編集', '取り消す')
      await vi.waitFor(() => expect(shell.execCommand).toHaveBeenCalledWith('undo'))
      expect(store?.undo).toHaveBeenCalledOnce()
    })

    test('undo does nothing outside the page editor', async () => {
      const shell = await setup({ libraryProjects: [fileProject], currentId: fileProject.id })
      shell.click('編集', '取り消す')
      await vi.waitFor(() => expect(shell.library.open).not.toHaveBeenCalled())
      expect(shell.stores.get(fileProject.id)?.undo).not.toHaveBeenCalled()
    })

    test('clearing the history empties the recent files', async () => {
      const shell = await setup({ recent: [{ path: '/w/a.manga.json', projectId: 'p' }] })
      shell.click('ファイル', '最近開いたファイル', '履歴を消す')
      await vi.waitFor(() => expect(shell.store.values.get('recentFiles')).toEqual([]))
      await vi.waitFor(() =>
        expect(shell.find(['ファイル', '最近開いたファイル']).items).toEqual([
          { text: 'なし', enabled: false },
        ]),
      )
    })

    test('the View menu navigates to the project list and opens the settings over the current screen', async () => {
      const shell = await setup()
      shell.click('表示', 'プロジェクト一覧')
      shell.click('表示', 'アプリ設定')
      const [[list], [settings]] = shell.router.navigate.mock.calls as unknown as [
        [unknown],
        [{ search(prev: object): object }],
      ]
      expect(list).toEqual({ to: '/' })
      expect(settings).toMatchObject({ to: '.', replace: true })
      expect(settings.search({ q: 1 })).toEqual({ q: 1, settings: 'app' })
    })
  })
}
