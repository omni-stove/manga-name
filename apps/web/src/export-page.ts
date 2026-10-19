import { m } from '@manga/i18n'
import type { ExportJob, ExportReply, ExportRequest } from './export-page-job'

/** `Worker` のうち exporter が使う部分。テストでは Worker の代わりに同じ形のものを渡す */
interface WorkerLike {
  onmessage: ((e: MessageEvent<ExportReply>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  postMessage(request: ExportRequest): void
  terminate(): void
}

export interface PageExporter {
  /**
   * ExportJob を Worker で描いて PNG、zip、PDF のいずれかを返す。描いている間メインスレッドは空く。
   * 1 ページ描き終えるごとに onProgress を呼ぶ
   */
  run(job: ExportJob, onProgress?: (done: number, total: number) => void): Promise<Blob>
}

interface Pending {
  resolve(blob: Blob): void
  reject(error: unknown): void
  onProgress?(done: number, total: number): void
}

const spawnWorker = (): WorkerLike =>
  new Worker(new URL('./export-page.worker.ts', import.meta.url), { type: 'module' })

/**
 * Worker を初回の書き出しで作り、以後使い回す。フォントの読み込みが 1 回で済む。
 * Worker 自体が落ちたら待っている書き出しを全部失敗にし、次の書き出しで作り直す
 */
function createPageExporter(spawn: () => WorkerLike = spawnWorker): PageExporter {
  let worker: WorkerLike | undefined
  let nextId = 1
  const pending = new Map<number, Pending>()

  const drop = (error: Error) => {
    worker?.terminate()
    worker = undefined
    for (const p of pending.values()) p.reject(error)
    pending.clear()
  }

  const ensureWorker = () => {
    if (worker) return worker
    const w = spawn()
    w.onmessage = (e) => {
      const reply = e.data
      const p = pending.get(reply.id)
      if (!p) return
      if (reply.kind === 'progress') {
        p.onProgress?.(reply.done, reply.total)
        return
      }
      pending.delete(reply.id)
      if (reply.kind === 'done') p.resolve(reply.blob)
      else p.reject(new Error(reply.message))
    }
    // 読み込みの失敗や onmessage の外の例外は、どの要求のものか分からない
    w.onerror = (e) => drop(new Error(e.message || m.web_export_worker_stopped()))
    worker = w
    return w
  }

  return {
    run: (job, onProgress) =>
      new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject, onProgress })
        ensureWorker().postMessage({ id, job })
      }),
  }
}

/** アプリ全体で 1 つの exporter。Worker は最初の書き出しまで作らない */
export const pageExporter = createPageExporter()

/**
 * 1 ページなら `title_p03.png`、複数なら `title_p01-03.zip` の形。番号はエピソード内の 1 始まり。
 * ファイル名に使えない文字は `_` にする
 */
export function exportFileName(title: string, numbers: readonly number[], ext: string): string {
  const safe = (title || m.untitled()).replace(/[\\/:*?"<>|]/g, '_')
  const pad = (n: number) => String(n).padStart(2, '0')
  const first = numbers[0] ?? 1
  const last = numbers.at(-1) ?? first
  return `${safe}_p${first === last ? pad(first) : `${pad(first)}-${pad(last)}`}.${ext}`
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest

  /** postMessage された要求を貯め、テストが `reply` で返事を返す偽の Worker */
  const fakeWorker = () => {
    const requests: ExportRequest[] = []
    let spawned = 0
    let terminated = 0
    let current: WorkerLike | undefined
    const spawn = (): WorkerLike => {
      spawned++
      current = {
        onmessage: null,
        onerror: null,
        postMessage: (request) => requests.push(request),
        terminate: () => terminated++,
      }
      return current
    }
    const reply = (data: ExportReply) => current?.onmessage?.({ data } as MessageEvent<ExportReply>)
    const fail = (message: string) => current?.onerror?.({ message } as ErrorEvent)
    return { spawn, requests, reply, fail, counts: () => ({ spawned, terminated }) }
  }

  const job = {} as ExportJob

  describe('createPageExporter', () => {
    test('resolves each export with the blob the worker posts back, on one worker', async () => {
      const w = fakeWorker()
      const exporter = createPageExporter(w.spawn)
      const progress: [number, number][] = []
      const a = exporter.run(job, (done, total) => progress.push([done, total]))
      const b = exporter.run(job)
      expect(w.requests.map((r) => r.id)).toEqual([1, 2])
      w.reply({ id: 1, kind: 'progress', done: 1, total: 2 })
      w.reply({ id: 2, kind: 'progress', done: 1, total: 1 })
      w.reply({ id: 2, kind: 'done', blob: new Blob(['b']) })
      w.reply({ id: 1, kind: 'error', message: 'boom' })
      expect(progress).toEqual([[1, 2]])
      expect(await (await b).text()).toBe('b')
      await expect(a).rejects.toThrow('boom')
      expect(w.counts()).toEqual({ spawned: 1, terminated: 0 })
    })

    test('a worker error rejects every pending export and the next export gets a new worker', async () => {
      const w = fakeWorker()
      const exporter = createPageExporter(w.spawn)
      const a = exporter.run(job)
      w.fail('script failed')
      await expect(a).rejects.toThrow('script failed')
      const b = exporter.run(job)
      expect(w.counts()).toEqual({ spawned: 2, terminated: 1 })
      w.reply({ id: 2, kind: 'done', blob: new Blob(['ok']) })
      expect(await (await b).text()).toBe('ok')
    })
  })

  test('exportFileName', () => {
    expect(exportFileName('夏の話', [3], 'png')).toBe('夏の話_p03.png')
    expect(exportFileName('', [1], 'png')).toBe(`${m.untitled()}_p01.png`)
    expect(exportFileName('a/b:c', [10], 'png')).toBe('a_b_c_p10.png')
    expect(exportFileName('夏の話', [1, 2, 3], 'pdf')).toBe('夏の話_p01-03.pdf')
  })
}
