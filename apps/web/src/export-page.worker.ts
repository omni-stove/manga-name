import { type ExportReply, type ExportRequest, runExportJob } from './export-page-job'

// lib が DOM なので self は Window の型になる。Worker として使う分だけ型を付ける
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ExportRequest>) => void) | null
  postMessage(reply: ExportReply): void
}

scope.onmessage = async (e) => {
  const { id, job } = e.data
  try {
    scope.postMessage({ id, ok: true, png: await runExportJob(job) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    scope.postMessage({ id, ok: false, message })
  }
}
