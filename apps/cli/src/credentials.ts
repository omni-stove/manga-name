import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** `manga login` で得た接続先とセッショントークン */
export interface Credentials {
  /** workers/api のオリジン */
  apiUrl: string
  token: string
}

/** 資格情報のファイル。`$XDG_CONFIG_HOME/manga/credentials.json`、無ければ `~/.config/manga/credentials.json` */
export function credentialsPath(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'manga', 'credentials.json')
}

/** path の資格情報。ファイルが無いか形が違えば null */
export async function readCredentials(path: string): Promise<Credentials | null> {
  let json: unknown
  try {
    json = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null) return null
  const { apiUrl, token } = json as Record<string, unknown>
  return typeof apiUrl === 'string' && typeof token === 'string' ? { apiUrl, token } : null
}

/** 資格情報を書く。トークンを他のユーザーに読ませないよう、ファイルは所有者だけが読める 0600 にする */
export async function writeCredentials(path: string, credentials: Credentials): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  // mode は新しく作るときにしか効かないので、前からあるファイルにも掛け直す
  await chmod(path, 0o600)
}

/** 資格情報を消す。無ければ何もしない */
export async function removeCredentials(path: string): Promise<void> {
  await rm(path, { force: true })
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { mkdtemp, stat } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')

  test('credentialsPath prefers XDG_CONFIG_HOME', () => {
    expect(credentialsPath({ XDG_CONFIG_HOME: '/x' })).toBe('/x/manga/credentials.json')
    expect(credentialsPath({})).toBe(join(homedir(), '.config', 'manga', 'credentials.json'))
  })

  test('writes, reads and removes the credentials, readable by the owner only', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'manga-cli-')), 'manga', 'credentials.json')
    expect(await readCredentials(path)).toBeNull()
    await writeCredentials(path, { apiUrl: 'https://api.test', token: 'tok' })
    expect(await readCredentials(path)).toEqual({ apiUrl: 'https://api.test', token: 'tok' })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await removeCredentials(path)
    await removeCredentials(path)
    expect(await readCredentials(path)).toBeNull()
  })

  test('a file of another shape reads as null', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'manga-cli-')), 'credentials.json')
    await writeFile(path, '{"apiUrl":1}')
    expect(await readCredentials(path)).toBeNull()
    await writeFile(path, 'null')
    expect(await readCredentials(path)).toBeNull()
  })
}
