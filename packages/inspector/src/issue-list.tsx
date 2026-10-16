import type { Issue } from '@manga/schema'
import styles from './issue-list.module.css'
import section from './section.module.css'
import type { IssueListProps } from './types'

const SEVERITY_RANK: Record<Issue['severity'], number> = { error: 0, warning: 1, info: 2 }

const SEVERITY_LABELS: Record<Issue['severity'], string> = {
  error: 'エラー',
  warning: '警告',
  info: '情報',
}

/** severity の重い順。同じ重さなら診断が出した順を保つ */
export const sortIssues = (issues: readonly Issue[]): Issue[] =>
  issues.toSorted((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

/** 診断の Issue の一覧。指す要素（焦点、フキダシ、コマ）がある Issue は押すと `onFocus` を呼ぶ */
export function IssueList({ issues, onFocus }: IssueListProps) {
  if (issues.length === 0) {
    return (
      <p className={section.muted} data-issue-list="empty">
        問題はありません
      </p>
    )
  }
  return (
    <ol className={styles.list} data-issue-list>
      {sortIssues(issues).map((issue, i) => (
        <li key={`${issue.code}-${issue.panelId ?? ''}-${issue.focusPointId ?? i}`}>
          <button
            type="button"
            className={styles.issue}
            data-severity={issue.severity}
            data-code={issue.code}
            disabled={issue.panelId === undefined && issue.focusPointId === undefined}
            onClick={() => onFocus(issue)}
          >
            <span className={styles.severity}>{SEVERITY_LABELS[issue.severity]}</span>
            <span>{issue.message}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}
