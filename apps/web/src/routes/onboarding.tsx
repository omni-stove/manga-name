import { EditorCanvas, type Layers } from '@manga/editor-canvas'
import { m } from '@manga/i18n'
import { currentArt } from '@manga/schema'
import { Button, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from 'zustand'
import { batchRunning, generatingPage, generatingPanels } from '../generate-panel'
import { exportOnboarding, openOnboarding } from '../onboarding/onboarding'
import { errorMessage } from '../route-error'
import { saveFile } from '../save-file'
import { toasts } from '../toasts'
import { useAssetResolver } from '../use-asset-resolver'
import { useProject } from '../use-project'
import styles from './onboarding.module.css'

export const Route = createFileRoute('/onboarding')({
  loader: ({ context }) => openOnboarding(context.imageProvider),
  component: Onboarding,
})

const SCOPE = 'onboarding'

const LAYERS: Layers = {
  reference: false,
  art: true,
  scribble: false,
  hints: false,
  diagnosis: false,
  frames: false,
}

const noop = () => {}

/**
 * 用意したコマ割りとセリフの 1 ページを、編集できないキャンバスで見せる。「ネームを生成」でページの絵を生成してコマに入れる。
 * 生成した絵は開いている間だけメモリに持ち、「書き出し」で固定のコンテンツにする zip を保存する
 */
function Onboarding() {
  const { library, store, generation, projectId, pageId } = Route.useLoaderData()
  const project = useProject(store)
  const resolveAsset = useAssetResolver(library.resolveAsset)
  const generatingState = useStore(generation.generating)
  const running = batchRunning(generatingState, projectId, SCOPE)
  const page = project.episodes[0]?.pages.find((p) => p.id === pageId)
  if (!page) return null
  const generated = page.panels.some((panel) => currentArt(panel))
  // 結果は generation がトーストと Patch で出すので、ここでは待たない
  const generate = () =>
    void generation.generateAll({
      store,
      projectId,
      scope: SCOPE,
      pageIds: [pageId],
      includeGenerated: true,
    })
  const exportZip = () =>
    exportOnboarding(store.get(), library.loadAsset)
      .then((blob) => saveFile(blob, 'onboarding.zip', [{ name: 'ZIP', extensions: ['zip'] }]))
      .catch((e: unknown) =>
        toasts.push(m.web_onboarding_export_failed({ reason: errorMessage(e) })),
      )
  return (
    <YStack as="section" gap={0} className={styles.onboarding}>
      <XStack as="header" gap={20} rowGap={12} wrap className={styles.toolbar}>
        <Typography variant="title">{m.web_onboarding_title()}</Typography>
        <Typography tone="muted">{m.web_onboarding_description()}</Typography>
        <XStack as="span" gap={6} className={styles.actions}>
          {running ? (
            <Button size="small" onClick={() => generation.cancel(projectId, SCOPE)}>
              {m.web_common_cancel()}
            </Button>
          ) : (
            <Button size="small" variant="primary" onClick={generate}>
              {m.web_onboarding_generate()}
            </Button>
          )}
          <Button size="small" disabled={!generated || running} onClick={() => void exportZip()}>
            {m.web_editor_export()}
          </Button>
        </XStack>
      </XStack>
      <div className={styles.canvas} inert>
        <EditorCanvas
          page={page}
          settings={project.settings}
          characters={project.characters}
          diagnosis={null}
          selection={null}
          tool="select"
          layers={LAYERS}
          generating={generatingPanels(generatingState, projectId)}
          generatingPage={generatingPage(generatingState, projectId, pageId)}
          onChange={noop}
          onSelect={noop}
          resolveAsset={resolveAsset}
        />
      </div>
    </YStack>
  )
}
