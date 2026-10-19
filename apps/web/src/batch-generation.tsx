import { m } from '@manga/i18n'
import type { ID } from '@manga/schema'
import { Button, Checkbox, XStack } from '@manga/ui'
import { useState } from 'react'
import { useStore } from 'zustand'
import { batchRunning, type PanelGeneration } from './generate-panel'
import type { ProjectStore } from './store/project-store-types'

interface BatchScope {
  generation: PanelGeneration
  store: ProjectStore
  projectId: ID
  /** `generateAll` の scope。ページなら `page/<id>`、エピソードなら `episode/<id>` */
  scope: string
  pageIds: readonly ID[]
}

/** 範囲の一括生成の状態と操作。「生成済みも含める」は画面を離れると既定の off に戻る */
export function useBatchGeneration({ generation, store, projectId, scope, pageIds }: BatchScope) {
  const running = useStore(generation.generating, (s) => batchRunning(s, projectId, scope))
  const [includeGenerated, setIncludeGenerated] = useState(false)
  return {
    running,
    includeGenerated,
    setIncludeGenerated,
    // 結果は generation がトーストと Patch で出すので、ここでは待たない
    start: () =>
      void generation.generateAll({ store, projectId, scope, pageIds, includeGenerated }),
    cancel: () => generation.cancel(projectId, scope),
  }
}

/** 「生成済みも含める」と、走っている間のキャンセル */
export function BatchOptions({ batch }: { batch: ReturnType<typeof useBatchGeneration> }) {
  return (
    <XStack as="span" wrap>
      <Checkbox
        label={m.web_batch_include_generated()}
        checked={batch.includeGenerated}
        disabled={batch.running}
        onChange={(e) => batch.setIncludeGenerated(e.currentTarget.checked)}
      />
      {batch.running && (
        <Button size="small" onClick={batch.cancel}>
          {m.web_common_cancel()}
        </Button>
      )}
    </XStack>
  )
}
