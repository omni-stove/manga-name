import { newId, parseProject } from '@manga/schema'
import type * as TauriFs from '@tauri-apps/plugin-fs'
import { byUpdatedAtDesc, type ProjectSummary, type StorageAdapter, summarize } from './adapter'

/** createFileStorage が使う `@tauri-apps/plugin-fs` の関数。テストでは同じ形の偽物を渡す */
export type FileSystem = Pick<
  typeof TauriFs,
  | 'exists'
  | 'mkdir'
  | 'readDir'
  | 'readFile'
  | 'readTextFile'
  | 'remove'
  | 'rename'
  | 'writeFile'
  | 'writeTextFile'
>

export interface FileStorageOptions {
  /** プロジェクトを置くディレクトリ。`baseDir` からの相対パス。既定 `projects` */
  dir?: string
  /** `dir` の基準。既定は `BaseDirectory.AppData` */
  baseDir?: TauriFs.BaseDirectory
  /** 既定は `@tauri-apps/plugin-fs` */
  fs?: FileSystem
}

const PROJECT_SUFFIX = '.manga.json'
const ASSETS_SUFFIX = '.manga.assets'
const FILE_PREFIX = 'file:'

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}
const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
}

/**
 * Tauri のファイルシステムに保存する StorageAdapter。
 * プロジェクトは `<dir>/<id>.manga.json`、アセットは `<dir>/<id>.manga.assets/` に置き、
 * ref は `file:<id>.manga.assets/<file>`（`dir` からの相対パス）にする。
 * plugin-fs は最初の操作で読み込むので、Tauri の外で作るだけなら失敗しない。
 */
export function createFileStorage(options: FileStorageOptions = {}): StorageAdapter {
  const { dir = 'projects' } = options
  let loading: Promise<{ fs: FileSystem; baseDir?: TauriFs.BaseDirectory }> | undefined
  const ready = () => {
    loading ??= (async () => {
      if (options.fs) return { fs: options.fs, baseDir: options.baseDir }
      const fs = await import('@tauri-apps/plugin-fs')
      return { fs, baseDir: options.baseDir ?? fs.BaseDirectory.AppData }
    })().catch((e) => {
      loading = undefined
      throw e
    })
    return loading
  }

  const path = (relative: string) => `${dir}/${relative}`
  const projectFile = (id: string) => path(`${safeName(id)}${PROJECT_SUFFIX}`)
  const assetsDir = (id: string) => `${safeName(id)}${ASSETS_SUFFIX}`

  const readAsset = async (ref: string) => {
    const relative = parseFileRef(ref)
    const { fs, baseDir } = await ready()
    if (!(await fs.exists(path(relative), { baseDir }))) {
      throw new Error(`Asset not found: ${ref}`)
    }
    const bytes = await fs.readFile(path(relative), { baseDir })
    // readFile の Uint8Array は SharedArrayBuffer の可能性を型に残すので、Blob が受け取れる形に写す
    return new Blob([new Uint8Array(bytes)], { type: mimeType(relative) })
  }

  return {
    async listProjects() {
      const { fs, baseDir } = await ready()
      if (!(await fs.exists(dir, { baseDir }))) return []
      const entries = await fs.readDir(dir, { baseDir })
      const summaries = await Promise.all(
        entries
          .filter((e) => e.isFile && e.name.endsWith(PROJECT_SUFFIX))
          .map(async (e): Promise<ProjectSummary | undefined> => {
            // 1 ファイルが壊れていても他のプロジェクトは一覧に出したいので、読めないものだけ外す
            try {
              const json = await fs.readTextFile(path(e.name), { baseDir })
              return summarize(parseProject(JSON.parse(json)))
            } catch {
              return undefined
            }
          }),
      )
      return summaries.filter((s) => s !== undefined).sort(byUpdatedAtDesc)
    },
    async loadProject(id) {
      const { fs, baseDir } = await ready()
      const file = projectFile(id)
      if (!(await fs.exists(file, { baseDir }))) throw new Error(`Project not found: ${id}`)
      return parseProject(JSON.parse(await fs.readTextFile(file, { baseDir })))
    },
    async saveProject(p) {
      const { fs, baseDir } = await ready()
      const file = projectFile(p.id)
      await fs.mkdir(dir, { baseDir, recursive: true })
      // 書き込み途中で落ちても前の保存内容が残るよう、別名に書き切ってから置き換える。
      // 一時ファイル名を毎回変えるのは、並行した保存が同じ一時ファイルを取り合わないため
      const tmp = `${file}.${newId()}.tmp`
      try {
        await fs.writeTextFile(tmp, `${JSON.stringify(p, null, 2)}\n`, { baseDir })
        await fs.rename(tmp, file, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir })
      } catch (error) {
        // 片付けの失敗で元の失敗を隠さない
        await fs.remove(tmp, { baseDir }).catch(() => undefined)
        throw error
      }
    },
    async deleteProject(id) {
      const { fs, baseDir } = await ready()
      const file = projectFile(id)
      const assets = path(assetsDir(id))
      if (await fs.exists(file, { baseDir })) await fs.remove(file, { baseDir })
      if (await fs.exists(assets, { baseDir })) {
        await fs.remove(assets, { baseDir, recursive: true })
      }
    },
    async resolveAsset(ref) {
      return URL.createObjectURL(await readAsset(ref))
    },
    async loadAsset(ref) {
      return readAsset(ref)
    },
    async putAsset(projectId, blob, hint) {
      const { fs, baseDir } = await ready()
      const assets = assetsDir(projectId)
      const label = slug(hint ?? '')
      const prefix = label ? `${label}-` : ''
      const relative = `${assets}/${prefix}${newId()}.${EXTENSIONS[blob.type] ?? 'bin'}`
      await fs.mkdir(path(assets), { baseDir, recursive: true })
      await fs.writeFile(path(relative), new Uint8Array(await blob.arrayBuffer()), { baseDir })
      return `${FILE_PREFIX}${relative}`
    },
  }
}

/** id をファイル名に使う。`dir` の外を指しうる id は throw する */
function safeName(id: string): string {
  if (id === '' || id === '.' || id === '..' || /[\\/:*?"<>|\p{Cc}]/u.test(id)) {
    throw new Error(`Invalid project id for a file name: ${id}`)
  }
  return id
}

/** `file:<relative path>` から相対パスを取り出す。`dir` の外を指す ref と他の形式は throw する */
function parseFileRef(ref: string): string {
  if (!ref.startsWith(FILE_PREFIX)) throw new Error(`Unsupported asset ref: ${ref}`)
  const relative = ref.slice(FILE_PREFIX.length)
  const segments = relative.split('/')
  if (
    relative === '' ||
    relative.includes('\\') ||
    segments.some((s) => s === '' || s === '.' || s === '..' || s.includes(':'))
  ) {
    throw new Error(`Unsupported asset ref: ${ref}`)
  }
  return relative
}

function mimeType(relative: string): string {
  return MIME_TYPES[relative.slice(relative.lastIndexOf('.') + 1)] ?? 'application/octet-stream'
}

/** hint をアセットのファイル名の頭に付けられる形にする。使える文字が無ければ空文字 */
function slug(hint: string): string {
  return hint
    .replaceAll(/[^A-Za-z0-9_-]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .slice(0, 40)
}

if (import.meta.vitest) {
  const { createEmptyProject, fixtures } = await import('@manga/schema')
  const { describe, expect, test, vi } = import.meta.vitest

  /** パスをキーにファイルとディレクトリを持つ、plugin-fs の偽物。親ディレクトリが無い書き込みは実物と同じく失敗する */
  const createMemoryFs = () => {
    const files = new Map<string, string | Uint8Array<ArrayBuffer>>()
    const dirs = new Set<string>()
    const key = (p: string | URL) => String(p)
    const parentOf = (k: string) => k.slice(0, Math.max(k.lastIndexOf('/'), 0))
    const write = (p: string | URL, data: string | Uint8Array<ArrayBuffer>) => {
      const k = key(p)
      const parent = parentOf(k)
      if (parent !== '' && !dirs.has(parent)) throw new Error(`No such directory: ${parent}`)
      files.set(k, data)
    }
    const read = (p: string | URL) => {
      const data = files.get(key(p))
      if (data === undefined) throw new Error(`No such file: ${p}`)
      return data
    }
    const fs: FileSystem = {
      async exists(p) {
        return files.has(key(p)) || dirs.has(key(p))
      },
      async mkdir(p) {
        for (let k = key(p); k !== ''; k = parentOf(k)) dirs.add(k)
      },
      async readDir(p) {
        const prefix = `${key(p)}/`
        const children = [...files.keys(), ...dirs].filter(
          (k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'),
        )
        return children.map((k) => ({
          name: k.slice(prefix.length),
          isFile: files.has(k),
          isDirectory: dirs.has(k),
          isSymlink: false,
        }))
      },
      async readFile(p) {
        const data = read(p)
        if (typeof data === 'string') return new TextEncoder().encode(data)
        return data
      },
      async readTextFile(p) {
        const data = read(p)
        return typeof data === 'string' ? data : new TextDecoder().decode(data)
      },
      async remove(p, options) {
        const k = key(p)
        const under = [...files.keys(), ...dirs].filter((c) => c.startsWith(`${k}/`))
        if (under.length > 0 && !options?.recursive) throw new Error(`Directory not empty: ${k}`)
        if (!files.delete(k) && !dirs.delete(k)) throw new Error(`No such file: ${k}`)
        for (const c of under) {
          files.delete(c)
          dirs.delete(c)
        }
      },
      async rename(from, to) {
        const data = read(from)
        write(to, data)
        files.delete(key(from))
      },
      async writeFile(p, data) {
        if (!(data instanceof Uint8Array)) throw new Error('Streams are not supported')
        // 呼び出し側があとで書き換えても保存内容が変わらないよう写す
        write(p, new Uint8Array(data))
      },
      async writeTextFile(p, data) {
        if (typeof data !== 'string') throw new Error('Streams are not supported')
        write(p, data)
      },
    }
    return { fs, files }
  }

  const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
  const setup = () => {
    const { fs, files } = createMemoryFs()
    return { fs, files, storage: createFileStorage({ fs, dir: 'root' }) }
  }

  describe('file StorageAdapter', () => {
    test('saves a project as <id>.manga.json that passes parseProject', async () => {
      const { files, storage } = setup()
      await storage.saveProject(fixtures.samplePage01)
      const text = files.get(`root/${fixtures.samplePage01.id}.manga.json`)
      expect(typeof text).toBe('string')
      expect(parseProject(JSON.parse(text as string))).toEqual(fixtures.samplePage01)
      expect([...files.keys()].filter((k) => k.endsWith('.tmp'))).toEqual([])
    })

    test('a project saved by one adapter can be opened by another on the same files', async () => {
      const { fs } = createMemoryFs()
      await createFileStorage({ fs }).saveProject(fixtures.samplePage01)
      expect(await createFileStorage({ fs }).loadProject(fixtures.samplePage01.id)).toEqual(
        fixtures.samplePage01,
      )
    })

    test('listProjects is empty before anything is saved and skips unreadable files', async () => {
      const { files, storage } = setup()
      expect(await storage.listProjects()).toEqual([])
      const p = { ...createEmptyProject('a'), updatedAt: '2026-01-01T00:00:00.000Z' }
      await storage.saveProject(p)
      await storage.putAsset(p.id, png())
      files.set('root/broken.manga.json', '{')
      files.set('root/notes.txt', 'x')
      expect(await storage.listProjects()).toEqual([
        { id: p.id, title: 'a', updatedAt: p.updatedAt },
      ])
    })

    test('loadProject rejects a missing project and a file that does not pass parseProject', async () => {
      const { files, storage } = setup()
      await expect(storage.loadProject('nope')).rejects.toThrow(/not found/)
      files.set('root/bad.manga.json', '{"schemaVersion": 1}')
      await expect(storage.loadProject('bad')).rejects.toThrow()
    })

    test('a failed write leaves the previous save in place and no temporary file', async () => {
      const { files, fs, storage } = setup()
      const p = createEmptyProject('before')
      await storage.saveProject(p)
      vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk full'))
      await expect(storage.saveProject({ ...p, title: 'after' })).rejects.toThrow('disk full')
      expect((await storage.loadProject(p.id)).title).toBe('before')
      expect([...files.keys()]).toEqual([`root/${p.id}.manga.json`])
    })

    test('putAsset writes under <id>.manga.assets and returns a file: ref', async () => {
      const { files, storage } = setup()
      const ref = await storage.putAsset('prj', png(), 'panel art')
      expect(ref).toMatch(/^file:prj\.manga\.assets\/panel_art-.+\.png$/)
      // 使える文字が無い hint は頭に付けず、newId（nanoid の 21 文字）だけにする
      expect(await storage.putAsset('prj', png(), 'コマ')).toMatch(
        /^file:prj\.manga\.assets\/[\w-]{21}\.png$/,
      )
      expect(files.get(`root/${ref.slice('file:'.length)}`)).toEqual(
        new Uint8Array([137, 80, 78, 71]),
      )
    })

    test('putAsset returns a distinct ref each time', async () => {
      const { storage } = setup()
      expect(await storage.putAsset('prj', png())).not.toBe(await storage.putAsset('prj', png()))
    })

    test('loadAsset returns the bytes with the image type', async () => {
      const { storage } = setup()
      const blob = await storage.loadAsset(await storage.putAsset('prj', png()))
      expect(blob.type).toBe('image/png')
      expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([137, 80, 78, 71])
    })

    test('resolveAsset returns an object URL for the file', async () => {
      const { storage } = setup()
      const url = await storage.resolveAsset(await storage.putAsset('prj', png()))
      expect(url).toMatch(/^blob:/)
      URL.revokeObjectURL(url)
    })

    test('deleteProject removes the json and the assets directory', async () => {
      const { files, storage } = setup()
      const p = createEmptyProject('a')
      await storage.saveProject(p)
      const ref = await storage.putAsset(p.id, png())
      await storage.deleteProject(p.id)
      expect([...files.keys()]).toEqual([])
      await expect(storage.loadAsset(ref)).rejects.toThrow(/not found/)
      await expect(storage.deleteProject(p.id)).resolves.toBeUndefined()
    })

    test('rejects ids and refs that point outside the directory', async () => {
      const { storage } = setup()
      await expect(storage.loadProject('../x')).rejects.toThrow(/Invalid project id/)
      await expect(storage.saveProject({ ...createEmptyProject('a'), id: 'a/b' })).rejects.toThrow(
        /Invalid project id/,
      )
      await expect(storage.putAsset('..', png())).rejects.toThrow(/Invalid project id/)
      for (const ref of ['file:../x.png', 'file:/abs.png', 'file:a\\b.png', 'file:', 'blob:x']) {
        await expect(storage.loadAsset(ref)).rejects.toThrow(/Unsupported/)
      }
    })
  })
}
