/** ページから SharedWorker の同期サーバへ送るもの */
export type TabSyncRequest =
  | { type: 'send'; data: Uint8Array }
  | { type: 'close'; code?: number; reason?: string }

/** SharedWorker の同期サーバからページへ届くもの */
export type TabSyncReply =
  | { type: 'open' }
  | { type: 'message'; data: ArrayBuffer }
  | { type: 'close'; code: number; reason: string }
