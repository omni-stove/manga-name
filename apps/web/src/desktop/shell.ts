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
 * 編集の Undo / Redo は開いているプロジェクトの store に送る。
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
    const id = currentProjectId()
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

  const navigate = (to: '/' | '/settings') => () => void router.navigate({ to })

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
            { text: 'プロジェクト一覧', action: navigate('/') },
            { text: 'アプリ設定', accelerator: 'CmdOrCtrl+,', action: navigate('/settings') },
            ...(isMac ? [separator, predefined('Fullscreen'), predefined('Minimize')] : []),
          ],
        },
      ],
    })
    await menu.setAsAppMenu()
  }

  await rebuildMenu()
}
