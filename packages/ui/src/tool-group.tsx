import type { ReactNode } from 'react'
import styles from './tool-group.module.css'

/** ツールバーの中の、小さな見出し付きのまとまり */
export function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.label}>{label}</legend>
      {children}
    </fieldset>
  )
}
