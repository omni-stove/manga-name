import {
  type KeyboardEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import styles from './context-menu.module.css'

export interface ContextMenuItem {
  label: string
  /** 右端に添えるキーの表記。押せるようにはしない */
  shortcut?: string
  disabled?: boolean
  /** 選べる値の並びで、今の値なら true。渡すと `menuitemradio` になり、先頭に印を付ける */
  checked?: boolean
  onSelect(): void
}

interface ContextMenuProps {
  /** メニューの名前。読み上げに使う */
  label: string
  /** 開いた位置の画面座標。画面からはみ出すときは内側へずらす */
  x: number
  y: number
  /** `'separator'` は区切り線 */
  items: readonly (ContextMenuItem | 'separator')[]
  /** 項目を選んだあと、Esc、メニューの外を押したとき、画面の大きさが変わったときに呼ぶ */
  onClose(): void
}

/**
 * 右クリックで出すメニュー。開いている間だけマウントし、マウントで最初の押せる項目にフォーカスする。
 * 上下の矢印で項目を移り、Enter か Space か押下で選ぶ
 */
export function ContextMenu({ label, x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const close = useEffectEvent(() => onClose())

  // 項目へのフォーカスより先に控え、閉じたときに戻す。戻さないとフォーカスが body に落ち、キャンバスのキー操作が効かなくなる
  useLayoutEffect(() => {
    const opener = document.activeElement
    return () => {
      if (opener instanceof HTMLElement) opener.focus({ preventScroll: true })
    }
  }, [])

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPos({
      x: Math.max(0, Math.min(x, window.innerWidth - width)),
      y: Math.max(0, Math.min(y, window.innerHeight - height)),
    })
    enabledItems(menu)[0]?.focus()
  }, [x, y])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && ref.current?.contains(e.target))) close()
    }
    // capture で受け、メニューの外の押下がキャンバスの操作に届く前に閉じる
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      onClose()
      return
    }
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const enabled = enabledItems(e.currentTarget)
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement)
    enabled[(at + step + enabled.length) % enabled.length]?.focus()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={styles.menu}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 区切り線は並びの位置でしか見分けられない
          <hr key={`separator-${i}`} className={styles.separator} />
        ) : (
          <button
            key={item.label}
            type="button"
            {...(item.checked === undefined
              ? { role: 'menuitem' }
              : { role: 'menuitemradio', 'aria-checked': item.checked })}
            tabIndex={-1}
            disabled={item.disabled}
            className={styles.item}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            <span>
              {item.checked !== undefined && (
                <span aria-hidden className={styles.check}>
                  {item.checked ? '✓' : ''}
                </span>
              )}
              {item.label}
            </span>
            {item.shortcut && <kbd className={styles.shortcut}>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  )
}

function enabledItems(menu: HTMLElement): HTMLButtonElement[] {
  return [...menu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')]
}
