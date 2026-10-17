import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test as base, type TestInfo } from '@playwright/test'
import { createWebDriverSession, type WebDriverSession } from './webdriver'

const run = promisify(execFile)

/** `tauri build --debug --no-bundle` の出力。リリースビルドは起動時に更新を確かめてダイアログを出すので使わない */
const APP_BINARY =
  process.env.TAURI_APP ??
  fileURLToPath(
    new URL('../../apps/desktop/src-tauri/target/debug/manga-name-desktop', import.meta.url),
  )
const DRIVER_PORT = 4444
const DRIVER_URL = `http://127.0.0.1:${DRIVER_PORT}`
const IDENTIFIER = 'app.omnistove.manganame'

export interface DesktopApp {
  /** アプリの WebView */
  web: WebDriverSession
  /** アプリの AppData。createFileStorage はこの下の `projects` に置く */
  appData: string
  /** メインウィンドウにキーを押す。xdotool の書式（`ctrl+o`） */
  press(keys: string): Promise<void>
  /** 開くダイアログ（GTK）が出るのを待ち、path を選んで開く */
  openFile(path: string): Promise<void>
  /** 保存ダイアログ（GTK）が出るのを待ち、path に保存する */
  saveFile(path: string): Promise<void>
}

/**
 * xdotool で X のウィンドウを操作する。メニューのショートカットとネイティブダイアログは WebView の外にあり、
 * WebDriver からは触れないので、X サーバに実際のキー入力を送る
 */
const xdotool = (...args: string[]) => run('xdotool', args, { timeout: 15_000 })

/** 名前が title に一致するウィンドウが出るまで待ち、入力のフォーカスを移す */
async function focusWindow(title: string): Promise<void> {
  await xdotool(
    'search',
    '--sync',
    '--onlyvisible',
    '--name',
    `^${title}$`,
    'windowfocus',
    '--sync',
  )
}

/**
 * Desktop アプリを tauri-driver で起動するテスト。tauri-driver は Linux（WebKitWebDriver）と Windows でしか動かない。
 * XDG のディレクトリをテストごとに分けるので、ライブラリも最近開いたファイルも空の状態で始まる。
 * 失敗したときは WebView と X の画面全体のスクリーンショット、WebView の HTML、tauri-driver とアプリのログを残す
 */
export const test = base.extend<{ app: DesktopApp }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright は fixture の依存を分割代入から読む
  app: async ({}, use, testInfo) => {
    const home = testInfo.outputPath('home')
    const xdg = {
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'),
      XDG_CACHE_HOME: join(home, 'cache'),
    }
    await Promise.all(Object.values(xdg).map((dir) => mkdir(dir, { recursive: true })))

    const logPath = testInfo.outputPath('tauri-driver.log')
    const log = createWriteStream(logPath)
    const driver = spawn('tauri-driver', ['--port', String(DRIVER_PORT)], {
      env: { ...process.env, ...xdg },
    })
    driver.stdout.pipe(log)
    driver.stderr.pipe(log)

    let web: WebDriverSession | undefined
    try {
      await waitForDriver(driver)
      web = await createWebDriverSession(DRIVER_URL, {
        'tauri:options': { application: APP_BINARY },
      })
      await use({
        web,
        appData: join(xdg.XDG_DATA_HOME, IDENTIFIER),
        async press(keys) {
          await focusWindow('Manga Name')
          await xdotool('key', keys)
        },
        async openFile(path) {
          await focusWindow('Open File')
          // 最初の画面は「最近使ったファイル」で、Ctrl+L の欄は検索になる。/ を打つとパスを入れる欄が開くが、
          // 開くまでに打った文字は落ちるので、開いてから欄を全部打ち直す
          await xdotool('key', 'slash', 'sleep', '1', 'key', 'ctrl+a')
          await xdotool('type', '--delay', '20', path)
          await xdotool('key', 'Return')
        },
        async saveFile(path) {
          await focusWindow('Save File')
          // 名前の欄にフルパスを入れると、そのディレクトリのそのファイルに保存する
          await xdotool('key', 'ctrl+a')
          await xdotool('type', '--delay', '20', path)
          await xdotool('key', 'Return')
        },
      })
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus
      if (failed) await attachFailure(testInfo, web)
      await web?.quit().catch(() => {})
      driver.kill()
      log.end()
      if (failed) {
        await testInfo.attach('tauri-driver.log', { path: logPath, contentType: 'text/plain' })
      }
    }
  },
})

async function waitForDriver(driver: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000
  for (;;) {
    if (driver.exitCode !== null) throw new Error(`tauri-driver exited with ${driver.exitCode}`)
    const ready = await fetch(`${DRIVER_URL}/status`).then(
      (res) => res.ok,
      () => false,
    )
    if (ready) return
    if (Date.now() > deadline) throw new Error('tauri-driver did not start')
    await new Promise((r) => setTimeout(r, 200))
  }
}

/** 失敗の調べに使うものを report に添える。どれかが取れなくても残りは添える */
async function attachFailure(testInfo: TestInfo, web: WebDriverSession | undefined) {
  const screen = testInfo.outputPath('screen.png')
  await Promise.allSettled([
    // ネイティブダイアログは WebView の外なので、X の画面全体も撮る
    run('import', ['-window', 'root', screen]).then(() =>
      testInfo.attach('screen', { path: screen, contentType: 'image/png' }),
    ),
    web
      ?.screenshot()
      .then((body) => testInfo.attach('webview', { body, contentType: 'image/png' })),
    web
      ?.source()
      .then((body) => testInfo.attach('webview.html', { body, contentType: 'text/html' })),
  ])
}
