import { m } from '@manga/i18n'
import { IconButton, XStack } from '@manga/ui'
import type { ReactNode } from 'react'
import { useStore } from 'zustand'
import styles from './history-buttons.module.css'
import type { WebProjectStore } from './store/project-store-types'

/** キーの表記に添える修飾キー */
export const MOD =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

/** Undo と Redo のアイコンボタン。キーは useUndoShortcuts が受けるので、ここではヒントに出すだけ */
export function HistoryButtons({ store }: { store: WebProjectStore }) {
  const { canUndo, canRedo } = useStore(store.state)
  return (
    <XStack as="span" gap={2} role="group" aria-label={m.history()}>
      <IconButton
        size="small"
        label={m.web_history_undo()}
        title={m.web_history_undo_title({ shortcut: `${MOD}Z` })}
        aria-keyshortcuts="Meta+Z Control+Z"
        disabled={!canUndo}
        onClick={() => store.undo()}
      >
        <Icon>
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </Icon>
      </IconButton>
      <IconButton
        size="small"
        label={m.web_history_redo()}
        title={m.web_history_redo_title({ shortcut: `${MOD}Shift+Z` })}
        aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y"
        disabled={!canRedo}
        onClick={() => store.redo()}
      >
        <Icon>
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
        </Icon>
      </IconButton>
    </XStack>
  )
}

/** ヘッダーのアイコンボタンに入れる 24 四方の線画 */
export function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={styles.icon}
    >
      {children}
    </svg>
  )
}
