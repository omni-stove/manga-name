import type { ExportJob, ExportReply, ExportRequest } from './export-page-job'

/** `Worker` のうち exporter が使う部分。テストでは Worker の代わりに同じ形のものを渡す */
interface WorkerLike {
  onmessage: ((e: MessageEvent<ExportReply>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  postMessage(request: ExportRequest): void
  terminate(): void
}

export interface PageExporter {
  /** ExportJob を Worker で描いて PNG を返す。描いている間メインスレッドは空く */
  exportPng(job: ExportJob): Promise<Blob>
}

interface Pending {
  resolve(png: Blob): void
  reject(error: unknown): void
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
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data.png)
      else p.reject(new Error(e.data.message))
    }
    // 読み込みの失敗や onmessage の外の例外は、どの要求のものか分からない
    w.onerror = (e) => drop(new Error(e.message || 'Worker が停止しました'))
    worker = w
    return w
  }

  return {
    exportPng: (job) =>
      new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        ensureWorker().postMessage({ id, job })
      }),
  }
}

/** アプリ全体で 1 つの exporter。Worker は最初の書き出しまで作らない */
export const pageExporter = createPageExporter()

/** `title_p03.png` の形。ファイル名に使えない文字は `_` にする */
export function exportFileName(title: string, pageIndex: number): string {
  const safe = (title || '無題').replace(/[\\/:*?"<>|]/g, '_')
  return `${safe}_p${String(pageIndex + 1).padStart(2, '0')}.png`
}

/** Blob をブラウザのダウンロードとして保存する */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // click の直後に解放すると、ダウンロードが始まる前に URL が消えることがある
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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
    test('resolves each export with the png the worker posts back, on one worker', async () => {
      const w = fakeWorker()
      const exporter = createPageExporter(w.spawn)
      const a = exporter.exportPng(job)
      const b = exporter.exportPng(job)
      expect(w.requests.map((r) => r.id)).toEqual([1, 2])
      w.reply({ id: 2, ok: true, png: new Blob(['b']) })
      w.reply({ id: 1, ok: false, message: 'boom' })
      expect(await (await b).text()).toBe('b')
      await expect(a).rejects.toThrow('boom')
      expect(w.counts()).toEqual({ spawned: 1, terminated: 0 })
    })

    test('a worker error rejects every pending export and the next export gets a new worker', async () => {
      const w = fakeWorker()
      const exporter = createPageExporter(w.spawn)
      const a = exporter.exportPng(job)
      w.fail('script failed')
      await expect(a).rejects.toThrow('script failed')
      const b = exporter.exportPng(job)
      expect(w.counts()).toEqual({ spawned: 2, terminated: 1 })
      w.reply({ id: 2, ok: true, png: new Blob(['ok']) })
      expect(await (await b).text()).toBe('ok')
    })
  })

  test('exportFileName', () => {
    expect(exportFileName('夏の話', 2)).toBe('夏の話_p03.png')
    expect(exportFileName('', 0)).toBe('無題_p01.png')
    expect(exportFileName('a/b:c', 9)).toBe('a_b_c_p10.png')
  })
}
