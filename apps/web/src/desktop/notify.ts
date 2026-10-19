import { m } from '@manga/i18n'
import type { BatchCounts } from '../generate-panel'

/**
 * 一括生成が終わったことを OS の通知で知らせる。生成は待たされるので、ほかのアプリに移った人を呼び戻すため。
 * ウィンドウを見ているときは画面とトーストで分かるので出さず、絵を入れたコマも失敗したコマも無ければ（止めただけなら）出さない。
 * 通知の許可がまだなら最初の 1 回で求め、断られたら出さない。出せなくても throw しない。plugin-notification は Web のバンドルに入れないよう使うときに読み込む
 */
export async function notifyBatchDone(
  counts: BatchCounts,
  hasFocus: () => boolean = () => document.hasFocus(),
): Promise<void> {
  if (hasFocus() || counts.done + counts.failed === 0) return
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      '@tauri-apps/plugin-notification'
    )
    if (!(await isPermissionGranted()) && (await requestPermission()) !== 'granted') return
    sendNotification({
      title: 'Manga Name',
      body:
        counts.failed > 0
          ? m.web_desktop_batch_done_with_failures({ count: counts.done, failed: counts.failed })
          : m.web_desktop_batch_done({ count: counts.done }),
    })
  } catch {
    // 通知を出せなくても、結果は画面とトーストに出ている
  }
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest
  const { installFakeTauri } = await import('./fake-tauri')

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const counts = (done: number, failed = 0, canceled = 0): BatchCounts => ({
    done,
    failed,
    canceled,
    busy: 0,
  })

  /** plugin-notification が使う window.Notification と、許可がまだのときに聞く IPC の偽物 */
  const setup = (permission: NotificationPermission, answer: NotificationPermission) => {
    const sent: { title: string; body?: string }[] = []
    const requestPermission = vi.fn(async () => answer)
    class FakeNotification {
      static permission = permission
      static requestPermission = requestPermission
      constructor(title: string, opts: { body?: string }) {
        sent.push({ title, body: opts.body })
      }
    }
    installFakeTauri(vi.stubGlobal, () => false)
    vi.stubGlobal('Notification', FakeNotification)
    return { sent, requestPermission }
  }

  describe('notifyBatchDone', () => {
    test('tells how many panels got art, and how many failed', async () => {
      const { sent } = setup('granted', 'granted')
      await notifyBatchDone(counts(5), () => false)
      await notifyBatchDone(counts(4, 2), () => false)
      expect(sent).toEqual([
        { title: 'Manga Name', body: m.web_desktop_batch_done({ count: 5 }) },
        {
          title: 'Manga Name',
          body: m.web_desktop_batch_done_with_failures({ count: 4, failed: 2 }),
        },
      ])
    })

    test('stays quiet while the window has focus or when the batch was only canceled', async () => {
      const { sent } = setup('granted', 'granted')
      await notifyBatchDone(counts(5), () => true)
      await notifyBatchDone(counts(0, 0, 3), () => false)
      expect(sent).toEqual([])
    })

    test('asks for the permission once and stays quiet when refused', async () => {
      const refused = setup('default', 'denied')
      await notifyBatchDone(counts(5), () => false)
      expect(refused.requestPermission).toHaveBeenCalledOnce()
      expect(refused.sent).toEqual([])

      const granted = setup('default', 'granted')
      await notifyBatchDone(counts(5), () => false)
      expect(granted.sent).toHaveLength(1)
    })

    test('does not throw when the notification cannot be sent', async () => {
      setup('default', 'granted')
      installFakeTauri(vi.stubGlobal, () => {
        throw new Error('no plugin')
      })
      await expect(notifyBatchDone(counts(5), () => false)).resolves.toBeUndefined()
    })
  })
}
